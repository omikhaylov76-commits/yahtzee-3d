/**
 * Чистая модель рассадки по местам комнаты (2.1.e-2 → 2.2.a-1) — БЕЗ Socket.IO, поэтому тестируема
 * (см. seating.test.ts). Сетевая обвязка (создание сокета, join/disconnect, рассылка) — в
 * realtime.ts; авторитетная игровая логика партии — в rooms.ts. Тот же шов «чистое ↔ сокеты»,
 * что у rooms.ts/realtime.ts.
 */
import { normalizeName } from '../../shared/names';
import type { LobbyPayload, OpenTable } from '../../shared/protocol';
import type { RoomState } from './rooms';

/** До 4 игроков в комнате (2.2); партию запускает хозяин кнопкой Start при ≥ MIN_TO_START. */
export const ROOM_CAPACITY = 4;
export const MIN_TO_START = 2;

/** Одно место в комнате: к кому привязан живой сокет (null — место держим за ушедшим игроком). */
export interface Seat {
  socketId: string | null;
  playerId: string;
  /**
   * СЕКРЕТНЫЙ токен реконнекта места (2.4.c-1, ADR-0010): по нему (а НЕ по публичному `playerId`)
   * авторизуется reclaim при возврате. Выдаётся владельцу в `JoinedPayload`, другим не рассылается.
   */
  reconnectToken: string;
  name: string;
  /** Хозяин ли это место (создатель комнаты). Хозяин запускает партию в приватной комнате (2.2). */
  isHost: boolean;
  /** Готов к старту по согласию (ADR-0016, ready-up в open/persistent). Тоггл сообщением — в 2.5.b. */
  ready: boolean;
  /**
   * Когда место стало НЕ-готовым в open/persistent лобби (мс), иначе null. Предохранитель залипших
   * (2.5.e): sweeper освобождает место, простоявшее не-готовым дольше таймаута. Снимается при `ready`.
   */
  notReadySince: number | null;
  /**
   * Когда место осталось БЕЗ живого сокета во время ИДУЩЕЙ партии (мс), иначе null. По этому таймеру
   * сервер доигрывает за ушедшего (форфейт, 2.4.c-2, ADR-0009/0010), чтобы партия не висла на его ходу.
   * Ставится в disconnect-ветке (socketId→null in-game), снимается на reclaim. В лобби не используется
   * (там место удаляется сразу).
   */
  disconnectedAt: number | null;
  /** Залогиненный аккаунт (2.3.c-3): userId платформы или null (гость). Для статистики/лидерборда (2.3.e). */
  userId?: string | null;
}

/** Комната платформы: код (=id) + места + (опционально) идущая партия. `game===null` до старта. */
export interface Room {
  /** Код комнаты (Crockford base32) — он же ключ реестра комнат. */
  id: string;
  /**
   * Тип комнаты (ADR-0017): `private` — по коду (как 2.2, не в публичном списке); `open` — в
   * списке, вход без кода; `persistent` — дежурный стол сервера (не сносится, переживает партию).
   * `open`/`persistent` используют ready-up и реванш (ADR-0016); `private` — host-Start (2.2).
   */
  visibility: 'private' | 'open' | 'persistent';
  /** Отображаемое имя стола (open/persistent) для публичного списка (ADR-0017). Приватные — без названия. */
  title?: string;
  seats: Seat[];
  game: RoomState | null;
  /** Метка создания (мс) — для TTL/сборки мусора заброшенных комнат (ADR-0009, защита памяти). */
  createdAt: number;
  /**
   * Когда ИДУЩАЯ партия осталась без живых сокетов (мс), иначе null. Даёт grace-период на реконнект
   * (ADR-0010): sweeper сносит брошенную партию только спустя паузу, а не мгновенно при общем блипе
   * сети у всех игроков. Сбрасывается в null, как только кто-то вернулся (reclaim).
   */
  emptiedAt: number | null;
  /**
   * Партию пришлось доигрывать автоматически за вышедшего (форфейт, 2.4.c-2): сервер сходил за того, кто
   * отвалился и не вернулся за таймаут. Такой итог НЕ пишется в историю/рейтинг (ADR-0009/0018, анти-
   * накрутка «технической победой за уход»). Ставится при любом авто-добивании; сбрасывается при возврате
   * стола в лобби. Старт партии задаёт `false` (см. realtime: create/addSeat) — новая партия чиста.
   */
  forfeited: boolean;
}

/** Можно ли уже стартовать (host-Start, приватная комната): партия ещё не идёт и набрался минимум. */
export function canStart(room: Room): boolean {
  return room.game === null && room.seats.length >= MIN_TO_START;
}

/**
 * Готов ли стол к авто-старту по согласию (ADR-0016, ready-up в open/persistent): партия не идёт,
 * набралось ≥ MIN_TO_START и ВСЕ присутствующие отметились «готов». В лобби мёртвых мест нет
 * (disconnect их удаляет) → «все места» = «все присутствующие». Чистая; гейт visibility — в realtime.
 */
export function allReadyToStart(room: Room): boolean {
  return (
    room.game === null && room.seats.length >= MIN_TO_START && room.seats.every((s) => s.ready)
  );
}

/** Снимок состава лобби (до старта) для рассылки клиентам: список игроков, вместимость, готовность. */
export function lobbySnapshot(room: Room): LobbyPayload {
  return {
    roomId: room.id,
    players: room.seats.map((s, i) => ({
      seat: i,
      name: s.name,
      isHost: s.isHost,
      ready: s.ready,
    })),
    capacity: ROOM_CAPACITY,
    canStart: canStart(room),
  };
}

/**
 * Гарантировать наличие ЖИВОГО хозяина (минимальное наследование, 2.2.a-1; полное — 2.2.c). Если
 * живой хозяин уже есть — ничего. Иначе снимаем роль со всех и отдаём первому живому месту. Зовётся
 * после выхода игрока из лобби, чтобы было кому нажать Start. Возвращает нового хозяина (или undefined,
 * если живых мест не осталось).
 */
export function ensureHost(room: Room): Seat | undefined {
  const liveHost = room.seats.find((s) => s.isHost && s.socketId !== null);
  if (liveHost) return liveHost;
  for (const s of room.seats) s.isHost = false;
  const next = room.seats.find((s) => s.socketId !== null);
  if (next) next.isHost = true;
  return next;
}

/**
 * Сброс стола в лобби после завершившейся партии (ADR-0016, «стол переживает партию» / реванш) —
 * ТОЛЬКО для open/persistent (вызывающий гейтит по `visibility`; приватные комнаты не трогаем).
 * Партию обнуляем; места ушедших по ходу (`socketId===null`) убираем — они не реваншируют; готовность
 * всех сбрасываем; `emptiedAt` чистим (это маркер брошенной ПАРТИИ, не лобби); гарантируем живого
 * хозяина. Чистая (без сокетов) → тестируема. Рассылку нового состава и `room:reset` делает realtime.
 */
export function resetRoomToLobby(room: Room): void {
  room.game = null;
  room.seats = room.seats.filter((s) => s.socketId !== null);
  for (const s of room.seats) {
    s.ready = false;
    s.notReadySince = null; // предохранитель отсчитает заново со следующего тика (2.5.e)
    s.disconnectedAt = null; // оставшиеся — живые; маркер форфейта прошлой партии не тащим (2.4.c-2)
  }
  room.emptiedAt = null;
  room.forfeited = false; // новая партия чиста — прошлый форфейт не блокирует запись реванша (2.4.c-2)
  ensureHost(room);
}

/**
 * Предохранитель залипших (2.5.e): что сделать с НЕ-готовым местом open/persistent лобби. Ленивый отсчёт:
 * первый раз — `stamp` (засечь время), позже — `free` (освободить), если простояло не-готовым дольше
 * `timeoutMs`. Готовое место — `null` (не трогаем). Чистая → тестируема; применяет sweeper в realtime.
 */
export function readyTimeoutAction(
  seat: Seat,
  now: number,
  timeoutMs: number,
): 'stamp' | 'free' | null {
  if (seat.ready) return null;
  if (seat.notReadySince === null) return 'stamp';
  return now - seat.notReadySince > timeoutMs ? 'free' : null;
}

/**
 * Что сделать с БРОШЕННОЙ ВСЕМИ партией (2.7): при отсутствии живых сокетов убрать стол, если партия либо
 * УЖЕ доиграна (`gameOver`: форфейтом/естественно — реконнектиться не к чему), либо брошена дольше grace на
 * реконнект (ADR-0010). `'reset'` — для persistent (вернуть дежурный стол в лобби), `'delete'` — для прочих
 * (open/private — снос), иначе `null` (есть живые / ещё ждём в пределах grace). `gameOver` передаёт
 * вызывающий (`module.isGameOver(state)`), чтобы не тянуть игровой модуль в seating. Чистая → тестируема.
 */
export function abandonedGameAction(
  room: Room,
  now: number,
  graceMs: number,
  gameOver: boolean,
): 'reset' | 'delete' | null {
  const noLive = room.seats.length === 0 || room.seats.every((s) => s.socketId === null);
  if (!noLive) return null;
  const graceElapsed = room.emptiedAt !== null && now - room.emptiedAt > graceMs;
  if (!gameOver && !graceElapsed) return null;
  return room.visibility === 'persistent' ? 'reset' : 'delete';
}

/** Дежурные (persistent) столы сервера (ADR-0017): 5 постоянных, морская тема в тон Auros. */
export const HOUSE_TABLES: readonly { id: string; title: string }[] = [
  { id: 'house-1', title: 'Tide Table' },
  { id: 'house-2', title: 'Coral Reef' },
  { id: 'house-3', title: 'The Lagoon' },
  { id: 'house-4', title: 'Deep Current' },
  { id: 'house-5', title: 'The Abyss' },
];

/**
 * Свежие дежурные столы для посева в реестр при старте сервера (ADR-0017): пустое лобби, visibility
 * `persistent`. id ВНЕ Crockford-пространства кодов (`house-N` нормализуется в невалидный код) — вход
 * публичный по id (joinOpen, 2.5.d), не по секретному коду. Чистая (без сокетов) → тестируема; посев в
 * Map делает realtime. Каждый вызов — свежие объекты (без общих ссылок на `seats`).
 */
export function createHouseTables(): Room[] {
  return HOUSE_TABLES.map((t) => ({
    id: t.id,
    visibility: 'persistent' as const,
    title: t.title,
    seats: [],
    game: null,
    createdAt: 0, // persistent не подметается по TTL — значение createdAt неважно
    emptiedAt: null,
    forfeited: false,
  }));
}

/** Статус стола для публичного списка (2.5.d): идёт партия / заполнен / ждёт игроков. */
function tableStatus(room: Room): OpenTable['status'] {
  if (room.game) return 'in-game';
  if (room.seats.length >= ROOM_CAPACITY) return 'full';
  return 'waiting';
}

/**
 * Публичный список открытых/дежурных столов (ADR-0017, 2.5.d): только `visibility!=='private'`, только
 * агрегаты — без имён игроков и без секретных кодов приватных. `tableId` = публичный id для входа
 * (joinOpen). Чистая (без сокетов) → тестируема; зовётся из realtime для `GET /tables`.
 */
export function publicTables(rooms: Iterable<Room>): OpenTable[] {
  const out: OpenTable[] = [];
  for (const room of rooms) {
    if (room.visibility === 'private') continue;
    out.push({
      tableId: room.id,
      title: room.title ?? 'Open table',
      count: room.seats.length,
      capacity: ROOM_CAPACITY,
      status: tableStatus(room),
    });
  }
  return out;
}

/**
 * Найти место для RECLAIM при реконнекте (2.1.e-2 → 2.4.c-1): место с таким СЕКРЕТНЫМ `reconnectToken`
 * (выдан владельцу при входе). По токену, а НЕ по публичному `playerId` (ADR-0010): иначе любой с
 * угадываемым id занял бы чужое место. Матчим НЕЗАВИСИМО от текущего `socketId`: engine.io может узнать о
 * смерти старого сокета с задержкой (ping-timeout) уже ПОСЛЕ возврата клиента новым сокетом — ждать
 * `socketId===null` нельзя, иначе reclaim упёрся бы в `room:full`. Пустой/неизвестный токен → undefined.
 * Перепривязку `socketId` и анти-затирание (вытеснение старого окна) делает вызывающий (realtime.ts).
 */
export function findReclaimSeat(room: Room, token: string | undefined): Seat | undefined {
  if (!token) return undefined;
  return room.seats.find((s) => s.reconnectToken === token);
}

/**
 * Развести одинаковые имена в комнате (2.2.b): если `name` уже занято кем-то из `existing` (сравнение
 * РЕГИСТРОНЕЗАВИСИМО — «Alice» и «alice» считаем одним), вернуть «name (2)», «name (3)»… до первого
 * свободного; иначе вернуть `name` как есть. Имена приходят уже нормализованными (`normalizeName` из
 * shared/names), так что сравниваем простым `toLocaleLowerCase`. Суффикс может вывести длину чуть за
 * `MAX_NAME_LEN` (два игрока с предельно длинными одинаковыми именами) — это лишь отображение в лобби,
 * не вопрос безопасности.
 */
export function dedupeName(existing: string[], name: string): string {
  const taken = new Set(existing.map((n) => n.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  // Кандидатов «(2)»… больше, чем занятых мест, => свободный гарантированно найдётся в этом диапазоне.
  for (let n = 2; n <= existing.length + 2; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return name; // недостижимо (принцип Дирихле) — страховка для типобезопасности
}

/**
 * Имя места в комнате (2.3.e-2b, ADR-0015): залогиненный играет под своим уникальным НИКОМ (обязателен
 * по гейту входа), гость — под введённым именем; пусто → дефолт «Player N». Чистая (тестируема). Общий
 * фильтр (NFC/невидимки/XSS/длина) — внутри `normalizeName`; дедуп одинаковых в комнате — `dedupeName`.
 */
export function seatName(
  sessionUser: { nickname: string | null } | null,
  rawName: string | undefined,
  seat: number,
): string {
  return normalizeName(sessionUser?.nickname ?? rawName) || `Player ${seat + 1}`;
}
