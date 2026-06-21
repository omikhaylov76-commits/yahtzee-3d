/**
 * Realtime-слой платформы (2.0.c→2.1.b→2.2.a-1, ADR-0009/0013). Рукопожатие с проверкой версии
 * протокола + авторитетный игровой цикл: создание/вход в комнату ПО КОДУ, лобби, ручной старт
 * хозяином, приём действий, рассылка публичного состояния с версией. Чистая логика партии — в
 * rooms.ts, рассадка/лобби/коды — в seating.ts/codes.ts; здесь только Socket.IO-обвязка, реестр
 * комнат в памяти и защита ресурсов (анти-перебор кода, TTL/cap комнат, лимит размера сообщения).
 *
 * 2.2.a-1: комнаты идентифицируются КОДОМ (Crockford base32). Создатель — хозяин; партия стартует
 * ТОЛЬКО по `room:start` от хозяина при ≥2 (авто-старт 2.1 убран). Клиентский UI (экраны/лобби) —
 * 2.2.a-2; полное наследование хозяина/кик/добровольный выход — 2.2.c.
 */
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { FastifyBaseLogger } from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  MSG,
  PROTOCOL_VERSION,
  type ActionMessage,
  type CreateRequest,
  type DeniedPayload,
  type GonePayload,
  type JoinOpenRequest,
  type JoinRequest,
  type JoinedPayload,
  type KickRequest,
  type OpenTable,
  type PresencePayload,
  type ReadyRequest,
  type ResetPayload,
  type StatePayload,
} from '../../shared/protocol';
import { applyForfeitTurn, applyNetworkAction, startGame, type YahtzeeModule } from './rooms';
import {
  allReadyToStart,
  canStart,
  createHouseTables,
  dedupeName,
  ensureHost,
  findReclaimSeat,
  HOUSE_TABLES,
  lobbySnapshot,
  publicTables,
  readyTimeoutAction,
  resetRoomToLobby,
  ROOM_CAPACITY,
  seatName,
  type Room,
} from './seating';
import { generateUniqueCode, isValidCode, normalizeCode } from './codes';
import { randomSeed, rollDiceValues } from './rng';
import type { SessionUser } from './auth/sessionResolver';
import { DELETED_PLAYER_NAME } from '../../shared/nickname';
import { normalizeName } from '../../shared/names';
import {
  actionMsgSchema,
  createReqSchema,
  joinOpenReqSchema,
  joinReqSchema,
  kickReqSchema,
  readyReqSchema,
} from '../../shared/schemas';
import { rowsForCompletedGame } from './stats/onGameOver';
import type { MatchRows } from './stats/buildRows';

const DICE_COUNT = 5;
const MAX_ROOMS = 500; // cap активных комнат на процесс — RAM узкое место (ADR-0009), graceful-отказ
const LOBBY_TTL_MS = 30 * 60_000; // заброшенное лобби (создали и не стартовали) подметаем
const GAME_GRACE_MS = 2 * 60_000; // идущую партию без живых держим столько на реконнект (ADR-0010)
const FORFEIT_MS = 60_000; // ушедшего В ПАРТИИ ждём столько, потом сервер доигрывает за него (форфейт, ADR-0010)
const SWEEP_EVERY_MS = 60_000; // период сборки мусора комнат
const MAX_JOIN_FAILS = 10; // анти-перебор кода: после серии неуспешных join сокет временно «залочен»
const JOIN_LOCK_MS = 30_000;
const MAX_CREATE_PER_SOCKET = 20; // анти-спам создания комнат с одного соединения
const MAX_MSG_BYTES = 4096; // лимит размера любого сокет-сообщения (анти-абьюз)
const READY_TIMEOUT_MS = 60_000; // предохранитель (2.5.e): не-готовое место open/persistent лобби освобождаем
const MAX_OPEN_PER_SOCKET = 3; // анти-спам (2.5.e): открытых столов на сокет (видны всем → строже общего cap)

/** Безопасный снимок для `/status` (2.P.2): ТОЛЬКО агрегаты — без кодов комнат и имён игроков. */
export interface StatusSnapshot {
  connections: number; // всего живых сокетов (включая ещё не севших в комнату)
  rooms: number; // активных комнат (с партией или живыми игроками; простаивающие дежурные не в счёт)
  inLobby: number; // из них в лобби (партия не начата)
  inGame: number; // из них с идущей партией
  playersOnline: number; // игроков с живым сокетом, сидящих в комнатах
}

export function attachRealtime(
  httpServer: HttpServer,
  log: FastifyBaseLogger,
  clientOrigin: string | string[],
  module: YahtzeeModule,
  // Опознание залогиненного игрока по cookie сессии (2.3.c-3); инъекция из композиционного корня
  // (БД-слой грузится только когда вход включён). Не передан → все играют гостями.
  sessionResolver?: (cookieHeader: string | undefined) => Promise<SessionUser | null>,
  // Запись итога завершённой партии в БД (2.3.d-2); инъекция (БД-слой ленив). Не передан → не пишем.
  recordMatch?: (rows: MatchRows) => Promise<string>,
): {
  io: Server;
  getStatus: () => StatusSnapshot;
  getTables: () => OpenTable[];
  isPlayerActive: (userId: string) => boolean;
  forgetUser: (userId: string) => void;
} {
  const io = new Server(httpServer, {
    cors: { origin: clientOrigin, credentials: true },
    maxHttpBufferSize: MAX_MSG_BYTES,
  });

  // Рукопожатие: кладём в socket.data залогиненного игрока (или null). Ошибку резолвера не валим в
  // disconnect — просто считаем гостем (вход не должен ломать игру).
  io.use((socket, next) => {
    if (!sessionResolver) {
      socket.data.user = null;
      next();
      return;
    }
    sessionResolver(socket.handshake.headers.cookie)
      .then((user) => {
        socket.data.user = user;
        next();
      })
      .catch(() => {
        socket.data.user = null;
        next();
      });
  });
  const rooms = new Map<string, Room>();
  // Дежурные (persistent) столы (ADR-0017): сеем один раз при старте; sweeper их не сносит, cap не считает.
  for (const table of createHouseTables()) rooms.set(table.id, table);
  log.info({ count: HOUSE_TABLES.length }, 'house tables seeded');
  const sockets = new Map<string, { roomId: string; playerId: string }>(); // socket.id -> место
  let connections = 0;

  /** Снимок состояния комнаты в протокольный payload. */
  function snapshot(room: Room, events: StatePayload['events']): StatePayload {
    const game = room.game!;
    return { stateVersion: game.stateVersion, state: module.toPublicState(game.state), events };
  }

  /** Разослать всем в комнате актуальный состав лобби (до старта партии). */
  function broadcastLobby(room: Room): void {
    io.to(room.id).emit(MSG.lobby, lobbySnapshot(room));
  }

  /**
   * Запустить партию в комнате: состояние ядра (места → игроки + серверный seed) и первый снимок всем.
   * Общий путь для ручного старта хозяином (приватная, 2.2) и авто-старта по готовности (open/persistent,
   * ADR-0016). Вызывающий уже проверил право/условие старта.
   */
  function startRoom(room: Room, by: 'host' | 'ready'): void {
    room.game = startGame(
      module,
      room.seats.map((s) => ({ id: s.playerId, name: s.name })),
      randomSeed(),
    );
    log.info({ roomId: room.id, players: room.seats.length, by }, 'game started');
    io.to(room.id).emit(MSG.state, snapshot(room, []));
  }

  /**
   * Разослать присутствие в ИДУЩЕЙ партии (2.2.d-2): кто сейчас на живом сокете. По этому списку клиент
   * понимает, что остался один (соперник вышел), и показывает баннер. В лобби не зовём — там состав идёт
   * через `room:lobby`. БЕЗ forfeit: партию не трогаем (авто-победа/таймеры — 2.4.c).
   */
  function broadcastPresence(room: Room): void {
    if (!room.game) return;
    io.to(room.id).emit(MSG.presence, {
      connected: room.seats.filter((s) => s.socketId !== null).map((s) => s.playerId),
    } satisfies PresencePayload);
  }

  /**
   * Запись итога завершённой партии в БД (2.3.d-2 → вынесено в 2.4.c-2 единой точкой). Не game:over /
   * форфейт / только гости → `rowsForCompletedGame` вернёт null (не пишем). Дубль actionId сюда не доходит
   * (realtime отсекает duplicate раньше) — записи не задвоить. Сбой записи логируем, но НЕ роняем игру (БД
   * вне realtime-петли, ADR-0009); лог без имён/PII (2.3.d).
   */
  function recordIfCompleted(room: Room, events: StatePayload['events']): void {
    if (!recordMatch || !room.game) return;
    const rows = rowsForCompletedGame(
      events,
      module.getResult(room.game.state),
      room.seats,
      module.id,
      room.forfeited,
      (playerId) => log.warn({ roomId: room.id, playerId }, 'finished-game seat missing'),
    );
    if (rows) {
      recordMatch(rows).catch((err) => log.error({ err, roomId: room.id }, 'recordMatch failed'));
    }
  }

  /**
   * Доиграть за ВЫШЕДШИХ игроков (форфейт, 2.4.c-2; ADR-0009 «выбывший на своём ходу → партия обязана
   * завершаться»). Пока ход у места без живого сокета, простоявшего дольше FORFEIT_MS, сервер ходит за него
   * (`applyForfeitTurn`) и рассылает новое состояние. Цикл промотает НЕСКОЛЬКО ушедших подряд («разом») и
   * встанет на ЖИВОМ игроке или на `game:over`. Любое авто-добивание метит партию `forfeited` (итог вне
   * рейтинга/истории, ADR-0018; гейт в `recordIfCompleted`). Зовём из sweeper-тика (таймер дропа гарантирует
   * завершение) и после успешного хода живого (чтобы не ждать таймаут на каждом круге ушедшего — C3-фикс).
   * Идемпотентно: Node однопоточный, `state` читается свежим; вернувшийся (reclaim снял `disconnectedAt`)
   * не форфейтится. Завершённую форфейтом партию НЕ пишем — стол сбросит/снесёт обычная ветка sweeper.
   */
  function runForfeits(room: Room, now: number): void {
    let acted = false;
    let guard = 0;
    const MAX_AUTO_TURNS = ROOM_CAPACITY * 13 + 1; // потолок ходов в партии — страховка от зацикливания
    while (room.game && !module.isGameOver(room.game.state) && guard++ < MAX_AUTO_TURNS) {
      const game = room.game;
      const seat = room.seats.find((s) => module.isPlayersTurn(game.state, s.playerId));
      if (!seat || seat.socketId !== null) break; // ход у живого / места нет — стоп
      if (seat.disconnectedAt === null || now - seat.disconnectedAt <= FORFEIT_MS) break; // ещё ждём возврата
      const result = applyForfeitTurn(
        module,
        game,
        seat.playerId,
        () => rollDiceValues(DICE_COUNT),
        randomUUID, // НЕугадываемый actionId: клиент не засеет processed[] заранее → каскад не зависнет
      );
      // Авто-ход не применился (denied/duplicate при рассинхроне) → выходим, НЕ метим форфейт и НЕ
      // зацикливаемся (версия не сдвинулась бы — тот же seat остался бы текущим). Норма: не наступает.
      if (result.denied || result.duplicate) break;
      room.game = result.room;
      room.forfeited = true;
      acted = true;
      io.to(room.id).emit(MSG.state, snapshot(room, result.events));
    }
    if (acted && room.game && module.isGameOver(room.game.state)) {
      log.info({ roomId: room.id }, 'game finished by forfeit — not recorded (ADR-0018)');
    }
  }

  /**
   * Переиндексация мест после УДАЛЕНИЯ из лобби (кик/выход): каждому ЖИВОМУ месту шлём его АКТУАЛЬНЫЙ
   * `joined` (новый seat + роль; свой `playerId` — не утечка), затем общий состав. Без этого у сдвинутых
   * игроков `mySeat` устаревает: пропадает «you»-бейдж, а промотированный хозяин не видит Start (баг 2.2.a).
   * При ДОБАВЛЕНии (join/create) resync не нужен — там `push` в конец, индексы прежних стабильны.
   */
  function resyncSeats(room: Room): void {
    room.seats.forEach((s, seat) => {
      if (s.socketId) {
        io.to(s.socketId).emit(MSG.joined, {
          roomId: room.id,
          playerId: s.playerId,
          seat,
          isHost: s.isHost,
          reconnectToken: s.reconnectToken, // владельцу — его же токен (свой playerId/токен не утечка)
        } satisfies JoinedPayload);
      }
    });
    broadcastLobby(room);
  }

  // Сборка мусора комнат. Лобби (game===null) без живых или давно не стартовавшее — сносим сразу.
  // ИДУЩУЮ партию без живых сносим лишь спустя GAME_GRACE_MS (grace на реконнект, ADR-0010): иначе
  // общий блип сети у всех игроков мгновенно потерял бы активную партию. unref — чтобы таймер не
  // держал процесс живым (на Railway/в тестах).
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      const noLive = room.seats.length === 0 || room.seats.every((s) => s.socketId === null);
      if (room.game === null) {
        // Предохранитель залипших (2.5.e): освобождаем НЕ-готовые места open/persistent лобби, простоявшие
        // дольше таймаута (ленивый отсчёт через notReadySince) — один молчун не должен блокировать стол.
        if (room.visibility !== 'private') {
          let freed = false;
          for (const s of [...room.seats]) {
            const act = readyTimeoutAction(s, now, READY_TIMEOUT_MS);
            if (act === 'stamp') {
              s.notReadySince = now;
            } else if (act === 'free') {
              room.seats = room.seats.filter((x) => x !== s);
              freed = true;
              if (s.socketId) {
                const vs = io.sockets.sockets.get(s.socketId);
                vs?.emit(MSG.kicked, { roomId: id }); // освобождён за бездействие — клиент уйдёт на вход
                vs?.leave(id);
                sockets.delete(s.socketId);
              }
              log.info({ roomId: id, playerId: s.playerId }, 'inactive (not-ready) seat freed');
            }
          }
          if (freed) {
            ensureHost(room);
            broadcastLobby(room);
          }
        }
        // Дежурный (persistent) стол не сносим — пустое лобби живёт всегда (ADR-0017).
        if (room.visibility === 'persistent') continue;
        if (noLive || now - room.createdAt > LOBBY_TTL_MS) {
          rooms.delete(id);
          log.info({ roomId: id }, 'lobby swept (idle/abandoned)');
        }
      } else {
        // Идущая партия: сперва доиграть за просроченных отсутствующих (таймер дропа, 2.4.c-2) — даже если
        // живые ещё есть (ход мог застрять на ушедшем); затем снос брошенной всеми партии по grace.
        runForfeits(room, now);
        if (noLive && room.emptiedAt !== null && now - room.emptiedAt > GAME_GRACE_MS) {
          // Брошенную партию дежурного стола НЕ удаляем — возвращаем стол в лобби (он постоянный, ADR-0017).
          if (room.visibility === 'persistent') {
            resetRoomToLobby(room);
            log.info({ roomId: id }, 'house table reset to lobby (abandoned game)');
          } else {
            rooms.delete(id);
            log.info({ roomId: id }, 'abandoned game swept (grace elapsed)');
          }
        }
      }
    }
  }, SWEEP_EVERY_MS);
  sweeper.unref();

  io.on('connection', (socket: Socket) => {
    // Версия протокола в рукопожатии — граница безопасности (ADR-0013).
    const version = socket.handshake.auth?.protocolVersion;
    if (version !== PROTOCOL_VERSION) {
      log.warn({ got: version, expected: PROTOCOL_VERSION }, 'protocol mismatch — disconnecting');
      socket.emit('protocol:mismatch', { server: PROTOCOL_VERSION });
      socket.disconnect(true);
      return;
    }

    connections++;
    log.info({ connections }, 'socket connected');
    socket.emit('hello', { protocol: PROTOCOL_VERSION });

    // Анти-перебор/анти-спам — состояние per-socket (живёт в замыкании этого соединения).
    let joinFails = 0;
    let joinLockedUntil = 0;
    let roomsCreated = 0;
    let openCreated = 0; // открытых столов создано этим сокетом (под-лимит, 2.5.e)

    /** Засчитать неуспешный join (анти-перебор кода): после серии неудач — временный лок сокета. */
    function failJoin(now: number): void {
      joinFails++;
      if (joinFails >= MAX_JOIN_FAILS) {
        joinLockedUntil = now + JOIN_LOCK_MS;
        joinFails = 0;
        log.warn({ socket: socket.id }, 'join brute-force — socket temporarily locked');
      }
    }

    /** Посадить ЭТОТ сокет новым игроком в комнату (fresh join) и вернуть конверт посадки. */
    function addSeat(room: Room, rawName: string | undefined, isHost: boolean): JoinedPayload {
      const seat = room.seats.length;
      const playerId = `seat-${randomUUID().slice(0, 8)}`;
      const reconnectToken = randomUUID(); // СЕКРЕТНЫЙ токен реконнекта места (2.4.c-1) — не публичный playerId
      // Залогиненный (ADR-0015) → его уникальный НИК; гость → присланное имя (seatName: общий фильтр
      // NFC/невидимки/XSS/длина внутри) → дефолт по месту → дедуп одинаковых в комнате.
      const sessionUser = (socket.data.user ?? null) as SessionUser | null;
      const base = seatName(sessionUser, rawName, seat);
      const name = dedupeName(
        room.seats.map((s) => s.name),
        base,
      );
      room.seats.push({
        socketId: socket.id,
        playerId,
        reconnectToken,
        name,
        isHost,
        ready: false, // готовность подтверждается в лобби (ready-up для open/persistent, 2.5.b)
        notReadySince: null, // предохранитель проставит при простое не-готовым (2.5.e)
        disconnectedAt: null, // таймер форфейта (2.4.c-2) — ставится при socketId→null в идущей партии
        userId: sessionUser?.userId ?? null,
      });
      sockets.set(socket.id, { roomId: room.id, playerId });
      socket.join(room.id);
      return { roomId: room.id, playerId, seat, isHost, reconnectToken };
    }

    /**
     * Гейт ника (2.3.e-2b, ADR-0015): залогиненного БЕЗ ника не пускаем в сетевую игру (создать/войти) —
     * авторитетная страховка к UI-онбордингу (e-3). Гость (user=null) проходит. Проверка по СВОЕМУ
     * аккаунту (без оракула о комнате) → зовём до room-lookup.
     */
    function needsNickname(): boolean {
      const u = (socket.data.user ?? null) as SessionUser | null;
      if (u && !u.nickname) {
        socket.emit(MSG.nicknameRequired);
        return true;
      }
      return false;
    }

    socket.on(MSG.create, (req: CreateRequest) => {
      const parsed = createReqSchema.safeParse(req);
      if (!parsed.success) return; // кривой запрос (2.3.c-4) — игнор
      if (needsNickname()) return; // залогиненный без ника — сперва онбординг (2.3.e-2b)
      // cap по ПОЛЬЗОВАТЕЛЬСКИМ комнатам — дежурные (persistent) всегда в реестре, их не учитываем (ADR-0017).
      const userRooms = [...rooms.values()].filter((r) => r.visibility !== 'persistent').length;
      if (roomsCreated >= MAX_CREATE_PER_SOCKET || userRooms >= MAX_ROOMS) {
        log.warn({ userRooms, perSocket: roomsCreated }, 'refusing create (cap reached)');
        socket.emit(MSG.full, { roomId: '' }); // перегрузка — переиспользуем «занято» (UI — 2.2.a-3)
        return;
      }
      let code: string;
      try {
        code = generateUniqueCode((c) => rooms.has(c));
      } catch {
        // Не нашли свободный код за лимит попыток — фактически перегрузка реестра; не глотаем молча.
        log.warn(
          { rooms: rooms.size },
          'could not allocate unique room code (registry overloaded)',
        );
        socket.emit(MSG.full, { roomId: '' });
        return;
      }
      // open=true → открытый стол (в списке, вход без кода, старт по готовности); иначе приватный по коду (2.2).
      const open = parsed.data.open === true;
      if (open && openCreated >= MAX_OPEN_PER_SOCKET) {
        log.warn({ openCreated }, 'refusing open-table create (per-socket cap, 2.5.e)');
        socket.emit(MSG.full, { roomId: '' }); // переиспользуем «занято/перегружен» (UI — 2.2.a-3)
        return;
      }
      const room: Room = {
        id: code,
        visibility: open ? 'open' : 'private',
        title: open ? normalizeName(parsed.data.title) || undefined : undefined,
        seats: [],
        game: null,
        forfeited: false,
        createdAt: Date.now(),
        emptiedAt: null,
      };
      rooms.set(code, room);
      roomsCreated++;
      if (open) openCreated++;
      // Приватная — создатель хозяин (host-Start, 2.2); открытая — без хозяина (старт по готовности, ADR-0016).
      const joined = addSeat(room, parsed.data.name, !open);
      if (open && !room.title) room.title = `${room.seats[0].name}'s table`; // дефолт названия из имени
      socket.emit(MSG.joined, joined);
      broadcastLobby(room);
      log.info(
        { roomId: code, visibility: room.visibility, playerId: joined.playerId },
        'room created',
      );
    });

    // Вход в ОТКРЫТЫЙ/дежурный стол по публичному id из списка (ADR-0017, 2.5.d): БЕЗ кода и БЕЗ
    // анти-перебора (список публичен). Приватные сюда не пускаем (только по коду). Reclaim ИДУЩЕЙ партии
    // при реконнекте — ниже. Лобби-hold/предохранитель залипших — e (анти-абьюз). Гейт ника — как в create.
    socket.on(MSG.joinOpen, (req: JoinOpenRequest) => {
      const parsed = joinOpenReqSchema.safeParse(req);
      if (!parsed.success) {
        socket.emit(MSG.notFound, { roomId: '' }); // кривой запрос — как «не найдено»
        return;
      }
      const { tableId, name, reconnectToken } = parsed.data;
      const room = rooms.get(tableId);

      // RECLAIM при реконнекте в ИДУЩУЮ партию (ADR-0010, 2.4.c-1): вернувшийся назвал СЕКРЕТНЫЙ
      // reconnectToken → возвращаем в держимое место и досылаем state. Гейт по `room.game`: лобби места
      // не держит. Токен присутствует ⇒ это попытка реклейма: если места/партии уже нет — `room:gone`
      // (НЕ молчаливый fresh-join в сброшенный/чужой стол).
      if (reconnectToken) {
        const reclaim =
          room && room.visibility !== 'private' && room.game
            ? findReclaimSeat(room, reconnectToken)
            : undefined;
        if (room && reclaim) {
          const prevSocketId = reclaim.socketId;
          reclaim.socketId = socket.id; // перепривязка на новый сокет
          reclaim.disconnectedAt = null; // вернулся в окно — отменяем таймер форфейта (2.4.c-2)
          room.emptiedAt = null; // кто-то вернулся — снимаем grace-таймер сноса партии
          sockets.set(socket.id, { roomId: room.id, playerId: reclaim.playerId });
          socket.join(room.id);
          // вытеснить старое окно, если оно ещё живо (анти-пинг-понг двух вкладок, 2.4.c-1)
          if (prevSocketId && prevSocketId !== socket.id) {
            io.sockets.sockets
              .get(prevSocketId)
              ?.emit(MSG.gone, { roomId: room.id } satisfies GonePayload);
          }
          socket.emit(MSG.joined, {
            roomId: room.id,
            playerId: reclaim.playerId,
            seat: room.seats.indexOf(reclaim),
            isHost: reclaim.isHost,
            reconnectToken: reclaim.reconnectToken,
          } satisfies JoinedPayload);
          socket.emit(MSG.state, snapshot(room, [])); // партия идёт — несём state.dice (e-1)
          broadcastPresence(room); // вернулся — оставшиеся снимут баннер «соперник вышел» (2.2.d-2)
          log.info({ roomId: room.id, playerId: reclaim.playerId }, 'player reclaimed open seat');
          return;
        }
        socket.emit(MSG.gone, { roomId: tableId } satisfies GonePayload); // партия завершена/стол сброшен
        return;
      }

      if (needsNickname()) return; // залогиненный без ника — сперва онбординг (2.3.e-2b)
      // Нет такого / приватная — «не найдено» (приватные комнаты через публичный список НЕ светим).
      if (!room || room.visibility === 'private') {
        socket.emit(MSG.notFound, { roomId: tableId });
        return;
      }
      if (room.game) {
        socket.emit(MSG.alreadyStarted, { roomId: room.id }); // партия идёт — войти нельзя (зрителей нет)
        return;
      }
      if (room.seats.length >= ROOM_CAPACITY) {
        socket.emit(MSG.full, { roomId: room.id });
        return;
      }
      const joined = addSeat(room, name, false); // открытый/дежурный стол без хозяина (ready-up)
      socket.emit(MSG.joined, joined);
      broadcastLobby(room);
      log.info(
        { roomId: room.id, playerId: joined.playerId, seat: joined.seat },
        'joined open table',
      );
    });

    socket.on(MSG.join, (req: JoinRequest) => {
      const parsed = joinReqSchema.safeParse(req);
      if (!parsed.success) {
        socket.emit(MSG.notFound, { roomId: '' }); // кривой запрос (2.3.c-4) — как «не найдено»
        return;
      }
      const { roomId, name, reconnectToken } = parsed.data;
      const code = normalizeCode(roomId);
      const room = isValidCode(code) ? rooms.get(code) : undefined;

      // RECLAIM при реконнекте (ADR-0010, 2.4.c-1): вернувшийся назвал СЕКРЕТНЫЙ reconnectToken —
      // возвращаем его в удерживаемое место ИДУЩЕЙ партии. Гейт по `room.game`: в лобби места не держатся
      // (disconnect их удаляет), reclaim уместен только для НАЧАТОЙ партии. Токен есть ⇒ это реклейм (не
      // перебор кода): лок брутфорса НЕ применяем; место/партии уже нет → `room:gone` (не fresh-join).
      if (reconnectToken) {
        const reclaim = room?.game ? findReclaimSeat(room, reconnectToken) : undefined;
        if (room && reclaim) {
          const prevSocketId = reclaim.socketId;
          reclaim.socketId = socket.id; // перепривязка на новый сокет
          reclaim.disconnectedAt = null; // вернулся в окно — отменяем таймер форфейта (2.4.c-2)
          room.emptiedAt = null; // кто-то вернулся — снимаем grace-таймер сноса партии
          joinFails = 0; // успешный возврат — это не перебор
          sockets.set(socket.id, { roomId: code, playerId: reclaim.playerId });
          socket.join(code);
          if (prevSocketId && prevSocketId !== socket.id) {
            io.sockets.sockets
              .get(prevSocketId)
              ?.emit(MSG.gone, { roomId: code } satisfies GonePayload); // вытеснить старое окно
          }
          socket.emit(MSG.joined, {
            roomId: code,
            playerId: reclaim.playerId,
            seat: room.seats.indexOf(reclaim),
            isHost: reclaim.isHost,
            reconnectToken: reclaim.reconnectToken,
          } satisfies JoinedPayload);
          socket.emit(MSG.state, snapshot(room, [])); // партия идёт (гейт выше) — несём state.dice (e-1)
          broadcastPresence(room); // вернулся — оставшиеся снимут баннер «соперник вышел» (2.2.d-2)
          log.info({ roomId: code, playerId: reclaim.playerId }, 'player reclaimed seat');
          return;
        }
        socket.emit(MSG.gone, { roomId: code } satisfies GonePayload); // комнаты/места/партии уже нет
        return;
      }

      const now = Date.now();
      if (now < joinLockedUntil) {
        // Залочен за перебор — молчим как при отсутствии комнаты (не подсказываем подборщику).
        socket.emit(MSG.notFound, { roomId });
        return;
      }
      if (needsNickname()) return; // залогиненный без ника — сперва онбординг (2.3.e-2b)

      // Любой join, не приведший к посадке/reclaim, считаем неудачей перебора (не даём оракул: ответы
      // not-found / already-started / full одинаково двигают счётчик лока).
      if (!room) {
        failJoin(now);
        socket.emit(MSG.notFound, { roomId: code });
        return;
      }
      if (room.game) {
        failJoin(now);
        socket.emit(MSG.alreadyStarted, { roomId: code }); // партия идёт — код больше не пускает
        return;
      }
      if (room.seats.length >= ROOM_CAPACITY) {
        failJoin(now);
        socket.emit(MSG.full, { roomId: code });
        return;
      }

      joinFails = 0; // успешный вход сбрасывает счётчик перебора
      const joined = addSeat(room, name, false);
      socket.emit(MSG.joined, joined);
      broadcastLobby(room);
      log.info({ roomId: code, playerId: joined.playerId, seat: joined.seat }, 'player joined');
    });

    socket.on(MSG.start, () => {
      const ctx = sockets.get(socket.id);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room) return;
      const me = room.seats.find((s) => s.playerId === ctx.playerId);
      if (!me?.isHost) return; // ручной старт хозяином — для приватной комнаты (2.2)
      if (!canStart(room)) return; // нужно ≥2 игроков и партия ещё не идёт
      startRoom(room, 'host');
    });

    // Готовность места (ADR-0016, ready-up): ТОЛЬКО open/persistent (приватные стартует хозяин выше).
    // Тоггл своего `ready` + рассылка состава; когда ВСЕ присутствующие готовы и их ≥2 — авто-старт.
    socket.on(MSG.ready, (req: ReadyRequest) => {
      const parsed = readyReqSchema.safeParse(req);
      if (!parsed.success) return; // кривой запрос (2.3.c-4) — игнор
      const ctx = sockets.get(socket.id);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room || room.game) return; // готовность только в ЛОББИ (партия не идёт)
      if (room.visibility === 'private') return; // приватные — host-Start, ready не применяется
      const me = room.seats.find((s) => s.playerId === ctx.playerId);
      if (!me) return;
      me.ready = parsed.data.ready;
      if (parsed.data.ready) me.notReadySince = null; // готов — предохранитель не считает (2.5.e)
      broadcastLobby(room);
      if (allReadyToStart(room)) startRoom(room, 'ready');
    });

    // «Play again» в открытом/дежурном столе (ADR-0016, 2.5.d-3b): после game:over игрок жмёт реванш →
    // стол сбрасывается в лобби и инициатор сразу готов; остальные вернутся по room:reset и тоже готовятся.
    // Только open/persistent (приватные — без сетевого реванша, создают новый стол). recordMatch уже был.
    socket.on(MSG.playAgain, () => {
      const ctx = sockets.get(socket.id);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room || room.visibility === 'private') return;
      if (!room.game || !module.isGameOver(room.game.state)) return; // только после завершённой партии
      resetRoomToLobby(room); // обнулить партию, снять готовность, убрать ушедших, гарантировать хозяина
      io.to(room.id).emit(MSG.reset, { roomId: room.id } satisfies ResetPayload);
      const me = room.seats.find((s) => s.playerId === ctx.playerId);
      if (me) me.ready = true; // инициатор реванша сразу готов
      broadcastLobby(room);
      log.info({ roomId: room.id, playerId: ctx.playerId }, 'play again — table reset to lobby');
      if (allReadyToStart(room)) startRoom(room, 'ready'); // редкий случай: остался один и сразу кворум
    });

    socket.on(MSG.kick, (req: KickRequest) => {
      const parsed = kickReqSchema.safeParse(req);
      if (!parsed.success) return; // кривой запрос (2.3.c-4) — игнор
      const ctx = sockets.get(socket.id);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room || room.game) return; // кик только в ЛОББИ; во время партии — forfeit (2.4.c)
      const me = room.seats.find((s) => s.playerId === ctx.playerId);
      if (!me?.isHost) return; // выгнать может только хозяин
      const seat = parsed.data.seat;
      if (seat < 0 || seat >= room.seats.length) return;
      const victim = room.seats[seat];
      if (victim.playerId === ctx.playerId) return; // себя не кикаем (для выхода — Leave/disconnect)

      room.seats.splice(seat, 1); // убрать место жертвы (индексы оставшихся сдвинутся → resync ниже)
      if (victim.socketId) {
        const vs = io.sockets.sockets.get(victim.socketId);
        vs?.emit(MSG.kicked, { roomId: room.id }); // уведомить жертву (её клиент уйдёт на экран входа)
        vs?.leave(room.id); // вывести её сокет из рассылки комнаты
        sockets.delete(victim.socketId); // забыть привязку (поздний disconnect жертвы не тронет комнату)
      }
      ensureHost(room); // страховка живого хозяина (жертва не хозяин, но единообразно)
      resyncSeats(room); // оставшимся — актуальные seat + состав
      log.info({ roomId: room.id, seat, playerId: victim.playerId }, 'player kicked by host');
    });

    socket.on(MSG.action, (msg: ActionMessage) => {
      const parsed = actionMsgSchema.safeParse(msg);
      if (!parsed.success) {
        // Кривое действие (2.3.c-4): вне-диапазонный index / неизвестный type / длинный actionId.
        socket.emit(MSG.denied, {
          reason: 'bad-action',
          actionId: (msg as { actionId?: string })?.actionId,
        } satisfies DeniedPayload);
        return;
      }
      const ctx = sockets.get(socket.id);
      if (!ctx) return; // действие без посадки — игнор
      const room = rooms.get(ctx.roomId);
      if (!room?.game) {
        socket.emit(MSG.denied, {
          reason: 'no-game',
          actionId: parsed.data.actionId,
        } satisfies DeniedPayload);
        return;
      }

      const result = applyNetworkAction(
        module,
        room.game,
        ctx.playerId,
        parsed.data as ActionMessage,
        () => rollDiceValues(DICE_COUNT),
      );
      room.game = result.room;

      if (result.duplicate) {
        // Повтор (дубль Socket.IO): состояние не менялось, шлём автору текущий снимок.
        socket.emit(MSG.state, snapshot(room, []));
        return;
      }
      if (result.denied) {
        socket.emit(MSG.denied, {
          reason: result.denied,
          actionId: parsed.data.actionId,
        } satisfies DeniedPayload);
        return;
      }
      // Успех: рассылаем новое авторитетное состояние + события всем в комнате.
      io.to(room.id).emit(MSG.state, snapshot(room, result.events));

      // Запись итога при ЕСТЕСТВЕННОМ завершении партии (2.3.d-2): единой точкой; форфейт/не-game:over/только
      // гости → внутри вернётся null (не пишем). Дубль actionId сюда не доходит (return по duplicate выше).
      recordIfCompleted(room, result.events);

      // Ход живого применён — сразу промотать просроченных отсутствующих перед следующим ходом (C3-фикс: не
      // ждать таймаут на каждом круге ушедшего). Партия уже завершилась → runForfeits сразу выйдет (isGameOver).
      runForfeits(room, Date.now());

      // ADR-0016: open/persistent стол ПЕРЕЖИВАЕТ партию, но сброс в лобби — НЕ авто на game:over
      // (иначе экран победителя мелькает), а по «Play again» игрока (MSG.playAgain, 2.5.d-3b): сперва
      // игроки видят итоги, затем кто-то жмёт реванш. recordIfCompleted выше уже записал итог на game:over.
    });

    socket.on('disconnect', () => {
      connections--;
      log.info({ connections }, 'socket disconnected');
      const ctx = sockets.get(socket.id);
      if (!ctx) return;
      sockets.delete(socket.id);
      const room = rooms.get(ctx.roomId);
      if (!room) return;
      if (room.game === null) {
        // Лобби: освобождаем место ПОЛНОСТЬЮ (иначе «мёртвое» место заняло бы слот). Затем
        // гарантируем живого хозяина (минимальное наследование) и обновляем состав у оставшихся.
        room.seats = room.seats.filter((s) => s.playerId !== ctx.playerId);
        if (room.seats.length === 0) {
          // Пустое лобби убираем сразу — КРОМЕ дежурного (persistent) стола: он постоянный (ADR-0017).
          if (room.visibility !== 'persistent') rooms.delete(room.id);
        } else {
          ensureHost(room);
          resyncSeats(room); // индексы сдвинулись после filter — освежить seat у оставшихся (баг 2.2.a)
        }
      } else {
        // Партия идёт: место держим за игроком (reclaim — 2.1.e-2). Обнуляем ТОЛЬКО если место всё
        // ещё за ЭТИМ сокетом: поздний disconnect старого сокета не должен затереть reclaim.
        const seat = room.seats.find((s) => s.playerId === ctx.playerId);
        if (seat && seat.socketId === socket.id) {
          seat.socketId = null;
          seat.disconnectedAt = Date.now(); // запустить таймер форфейта (2.4.c-2): сервер доиграет за ушедшего
        }
        // Если живых не осталось — НЕ сносим сразу: даём grace на реконнект (ADR-0010), реальный снос
        // делает sweeper по истечении GAME_GRACE_MS. Так общий блип сети не теряет активную партию.
        if (room.seats.every((s) => s.socketId === null)) room.emptiedAt = Date.now();
        broadcastPresence(room); // оставшимся: кто ещё на связи — оставшийся один увидит баннер (2.2.d-2)
      }
      log.info({ roomId: room.id, playerId: ctx.playerId }, 'player left');
    });
  });

  /**
   * Снимок для мониторинга (2.P.2). Только числа — НИКОГДА не отдаём `room.id` (это КОД-пропуск в
   * комнату) и `seat.name`. Синхронный проход по реестру (Node однопоточный — гонок нет).
   */
  function getStatus(): StatusSnapshot {
    let activeRooms = 0;
    let inLobby = 0;
    let inGame = 0;
    let playersOnline = 0;
    for (const room of rooms.values()) {
      const live = room.seats.some((s) => s.socketId !== null);
      // Простаивающий стол (нет партии и нет живых) — напр. пустой дежурный — не считаем активностью.
      if (room.game === null && !live) continue;
      activeRooms++;
      if (room.game === null) inLobby++;
      else inGame++;
      playersOnline += room.seats.filter((s) => s.socketId !== null).length;
    }
    return { connections, rooms: activeRooms, inLobby, inGame, playersOnline };
  }

  /** Публичный список открытых/дежурных столов для `GET /tables` (ADR-0017): только агрегаты, без имён/кодов. */
  function getTables(): OpenTable[] {
    return publicTables(rooms.values());
  }

  /**
   * Активен ли игрок СЕЙЧАС (2.3.e-6): есть место с его `userId` и ЖИВЫМ сокетом. Гейт удаления аккаунта.
   * По ЖИВОМУ сокету (не по держимому grace-месту) — чтобы не блокировать ушедшего 2-3 мин (аудит M1) и
   * сузить окно гонки удаления.
   */
  function isPlayerActive(userId: string): boolean {
    for (const room of rooms.values()) {
      if (room.seats.some((s) => s.userId === userId && s.socketId !== null)) return true;
    }
    return false;
  }

  /**
   * «Забыть» удалённый аккаунт (2.3.e-6, фикс C1/M3): рвём ВСЕ его сокеты (форс-реконнект → по новому
   * tokenVersion станут гостями) и обезличиваем любые его места (`userId=null`, имя → «Deleted player»),
   * чтобы запись итога ПОСЛЕ удаления не воскресила PID/ник. Зовётся ПОСЛЕ deleteAccount.
   */
  function forgetUser(userId: string): void {
    const drop = [...io.sockets.sockets.values()].filter(
      (s) => ((s.data.user ?? null) as SessionUser | null)?.userId === userId,
    );
    for (const s of drop) s.disconnect(true);
    for (const room of rooms.values()) {
      for (const seat of room.seats) {
        if (seat.userId === userId) {
          seat.userId = null;
          seat.name = DELETED_PLAYER_NAME;
        }
      }
    }
  }

  return { io, getStatus, getTables, isPlayerActive, forgetUser };
}
