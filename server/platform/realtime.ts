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
  type JoinRequest,
  type JoinedPayload,
  type KickRequest,
  type PresencePayload,
  type StatePayload,
} from '../../shared/protocol';
import { normalizeName } from '../../shared/names';
import { applyNetworkAction, startGame, type YahtzeeModule } from './rooms';
import {
  canStart,
  dedupeName,
  ensureHost,
  findReclaimSeat,
  lobbySnapshot,
  ROOM_CAPACITY,
  type Room,
} from './seating';
import { generateUniqueCode, isValidCode, normalizeCode } from './codes';
import { randomSeed, rollDiceValues } from './rng';
import type { SessionUser } from './auth/sessionResolver';
import {
  actionMsgSchema,
  createReqSchema,
  joinReqSchema,
  kickReqSchema,
} from '../../shared/schemas';

const DICE_COUNT = 5;
const MAX_ROOMS = 500; // cap активных комнат на процесс — RAM узкое место (ADR-0009), graceful-отказ
const LOBBY_TTL_MS = 30 * 60_000; // заброшенное лобби (создали и не стартовали) подметаем
const GAME_GRACE_MS = 2 * 60_000; // идущую партию без живых держим столько на реконнект (ADR-0010)
const SWEEP_EVERY_MS = 60_000; // период сборки мусора комнат
const MAX_JOIN_FAILS = 10; // анти-перебор кода: после серии неуспешных join сокет временно «залочен»
const JOIN_LOCK_MS = 30_000;
const MAX_CREATE_PER_SOCKET = 20; // анти-спам создания комнат с одного соединения
const MAX_MSG_BYTES = 4096; // лимит размера любого сокет-сообщения (анти-абьюз)

/** Безопасный снимок для `/status` (2.P.2): ТОЛЬКО агрегаты — без кодов комнат и имён игроков. */
export interface StatusSnapshot {
  connections: number; // всего живых сокетов (включая ещё не севших в комнату)
  rooms: number; // всего комнат в памяти
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
): { io: Server; getStatus: () => StatusSnapshot } {
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
        if (noLive || now - room.createdAt > LOBBY_TTL_MS) {
          rooms.delete(id);
          log.info({ roomId: id }, 'lobby swept (idle/abandoned)');
        }
      } else if (noLive && room.emptiedAt !== null && now - room.emptiedAt > GAME_GRACE_MS) {
        rooms.delete(id);
        log.info({ roomId: id }, 'abandoned game swept (grace elapsed)');
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
      // Залогиненный (2.3.c-3) → имя из профиля; гость → присланное. Общий фильтр (NFC/невидимки/XSS/
      // длина — shared/names) → дефолт по месту → дедуп в комнате.
      const sessionUser = (socket.data.user ?? null) as SessionUser | null;
      const base = normalizeName(sessionUser?.displayName ?? rawName) || `Player ${seat + 1}`;
      const name = dedupeName(
        room.seats.map((s) => s.name),
        base,
      );
      room.seats.push({
        socketId: socket.id,
        playerId,
        name,
        isHost,
        userId: sessionUser?.userId ?? null,
      });
      sockets.set(socket.id, { roomId: room.id, playerId });
      socket.join(room.id);
      return { roomId: room.id, playerId, seat, isHost };
    }

    socket.on(MSG.create, (req: CreateRequest) => {
      const parsed = createReqSchema.safeParse(req);
      if (!parsed.success) return; // кривой запрос (2.3.c-4) — игнор
      if (roomsCreated >= MAX_CREATE_PER_SOCKET || rooms.size >= MAX_ROOMS) {
        log.warn({ rooms: rooms.size, perSocket: roomsCreated }, 'refusing create (cap reached)');
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
      const room: Room = {
        id: code,
        seats: [],
        game: null,
        createdAt: Date.now(),
        emptiedAt: null,
      };
      rooms.set(code, room);
      roomsCreated++;
      const joined = addSeat(room, parsed.data.name, true); // создатель — хозяин
      socket.emit(MSG.joined, joined);
      broadcastLobby(room); // хозяин один — увидит себя в составе
      log.info({ roomId: code, playerId: joined.playerId }, 'room created');
    });

    socket.on(MSG.join, (req: JoinRequest) => {
      const parsed = joinReqSchema.safeParse(req);
      if (!parsed.success) {
        socket.emit(MSG.notFound, { roomId: '' }); // кривой запрос (2.3.c-4) — как «не найдено»
        return;
      }
      const { roomId, name, playerId } = parsed.data;
      const now = Date.now();
      if (now < joinLockedUntil) {
        // Залочен за перебор — молчим как при отсутствии комнаты (не подсказываем подборщику).
        socket.emit(MSG.notFound, { roomId });
        return;
      }
      const code = normalizeCode(roomId);
      const room = isValidCode(code) ? rooms.get(code) : undefined;

      // RECLAIM при реконнекте (2.1.e-2): вернувшийся клиент назвал свой playerId — возвращаем его в
      // удерживаемое место ИДУЩЕЙ партии и досылаем state. Гейт по `room.game`: в лобби места не
      // держатся (disconnect их удаляет), поэтому reclaim уместен только для НАЧАТОЙ партии — это и
      // сужает поверхность (подсадки в лобби по чужому playerId быть не может).
      const reclaim = room?.game ? findReclaimSeat(room, playerId) : undefined;
      if (room && reclaim) {
        reclaim.socketId = socket.id; // перепривязка на новый сокет (старый умрёт по ping-timeout)
        room.emptiedAt = null; // кто-то вернулся — снимаем grace-таймер сноса партии
        joinFails = 0; // успешный возврат — это не перебор
        sockets.set(socket.id, { roomId: code, playerId: reclaim.playerId });
        socket.join(code);
        const joined: JoinedPayload = {
          roomId: code,
          playerId: reclaim.playerId,
          seat: room.seats.indexOf(reclaim),
          isHost: reclaim.isHost,
        };
        socket.emit(MSG.joined, joined);
        socket.emit(MSG.state, snapshot(room, [])); // партия идёт (гейт выше) — несём state.dice (e-1)
        broadcastPresence(room); // вернулся — оставшиеся снимут баннер «соперник вышел» (2.2.d-2)
        log.info({ roomId: code, playerId: reclaim.playerId }, 'player reclaimed seat');
        return;
      }

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
      if (!me?.isHost) return; // запустить партию может только хозяин
      if (!canStart(room)) return; // нужно ≥2 игроков и партия ещё не идёт
      room.game = startGame(
        module,
        room.seats.map((s) => ({ id: s.playerId, name: s.name })),
        randomSeed(),
      );
      log.info({ roomId: room.id, players: room.seats.length }, 'game started by host');
      io.to(room.id).emit(MSG.state, snapshot(room, []));
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
          rooms.delete(room.id); // пустое лобби убираем сразу
        } else {
          ensureHost(room);
          resyncSeats(room); // индексы сдвинулись после filter — освежить seat у оставшихся (баг 2.2.a)
        }
      } else {
        // Партия идёт: место держим за игроком (reclaim — 2.1.e-2). Обнуляем ТОЛЬКО если место всё
        // ещё за ЭТИМ сокетом: поздний disconnect старого сокета не должен затереть reclaim.
        const seat = room.seats.find((s) => s.playerId === ctx.playerId);
        if (seat && seat.socketId === socket.id) seat.socketId = null;
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
    let inLobby = 0;
    let inGame = 0;
    let playersOnline = 0;
    for (const room of rooms.values()) {
      if (room.game === null) inLobby++;
      else inGame++;
      playersOnline += room.seats.filter((s) => s.socketId !== null).length;
    }
    return { connections, rooms: rooms.size, inLobby, inGame, playersOnline };
  }

  return { io, getStatus };
}
