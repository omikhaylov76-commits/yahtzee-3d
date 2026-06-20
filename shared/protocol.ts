/**
 * Общий контракт сетевого протокола платформы (ADR-0013). Импортируется И клиентом (src/),
 * И сервером (server/). Держать ЧИСТЫМ: без DOM/Node-специфики — только данные/типы.
 *
 * Версия протокола проверяется в рукопожатии Socket.IO (2.0.c): несовпадение клиента и сервера
 * -> «обнови страницу», действия не обрабатываются (граница безопасности, ADR-0013).
 *
 * v2 (2.1.b): добавлены реальные игровые сообщения (вход в комнату, действия, рассылка
 * состояния с версией). v1 был «hello world» (только рукопожатие) — с v2 он несовместим.
 *
 * v3 (2.2.a-1): комнаты по КОДУ вместо единственной `dev`. Добавлены `room:create` (создать
 * комнату, получить код), `room:start` (хозяин запускает партию при ≥2 — авто-старт убран),
 * рассылка состава лобби `room:lobby`, отказ `room:already-started`; в посадку добавлен `isHost`.
 * `roomId` теперь несёт КОД комнаты (в 2.1 это был литерал `dev`).
 */
import type { Category, DomainEvent, PublicGameState } from '../src/core';

export const PROTOCOL_VERSION = 3;

/** Имена сокет-сообщений (одна точка истины для клиента и сервера). */
export const MSG = {
  // клиент -> сервер
  create: 'room:create',
  join: 'room:join',
  start: 'room:start',
  kick: 'room:kick', // хозяин выгоняет игрока из лобби (2.2.c-1)
  action: 'action',
  // сервер -> клиент
  joined: 'room:joined',
  lobby: 'room:lobby',
  full: 'room:full',
  notFound: 'room:not-found',
  alreadyStarted: 'room:already-started',
  kicked: 'room:kicked', // тебя выгнал хозяин (2.2.c-1) — unicast жертве
  presence: 'room:presence', // кто на живом сокете в идущей партии (2.2.d-2): оставшийся один → баннер
  nicknameRequired: 'room:nickname-required', // залогиненный без ника просит вход → нужен онбординг (2.3.e-2b)
  state: 'state',
  denied: 'denied',
} as const;

/**
 * Действие игрока ПО СЕТИ — намеренно УЖЕ ядрового `Action`:
 * - нет `NEW_GAME` (партию создаёт только сервер при сборе игроков);
 * - у `ROLL` нет `values` (значения костей подставляет сервер из CSPRNG, ADR-0012) — клиент
 *   не может навязать выпавшие кости.
 */
export type NetworkAction =
  | { type: 'ROLL' }
  | { type: 'TOGGLE_HOLD'; index: number }
  | { type: 'SCORE'; category: Category };

/** Конверт действия с идемпотентным идентификатором (ADR-0013): повтор сервер игнорирует. */
export interface ActionMessage {
  action: NetworkAction;
  actionId: string;
}

/** Запрос на создание комнаты (2.2.a-1): сервер генерирует код и сажает автора хозяином. */
export interface CreateRequest {
  name?: string;
}

/** Запрос на вход в комнату по коду (2.2.a-1). `roomId` несёт КОД (сервер его нормализует). */
export interface JoinRequest {
  roomId: string;
  name?: string;
  /**
   * Reclaim места при РЕконнекте (2.1.e-2): вернувшийся клиент называет свой `playerId` (выданный
   * сервером при первом входе), чтобы сервер вернул его в удерживаемое место идущей партии, а не
   * отбил `room:full`. Первый вход — без поля. Полноценный reconnect-токен на место — 2.4.c.
   */
  playerId?: string;
}

/** Хозяин выгоняет игрока из лобби (2.2.c-1): `seat` — индекс места жертвы в текущем составе лобби. */
export interface KickRequest {
  seat: number;
}

/** Подтверждение посадки: стабильный `playerId` места (для авторизации действий), индекс и роль. */
export interface JoinedPayload {
  roomId: string;
  playerId: string;
  seat: number;
  /** Хозяин ли это место (создатель комнаты). Хозяин запускает партию кнопкой Start (2.2). */
  isHost: boolean;
}

/** Один игрок в составе лобби (до старта партии): место, имя, роль. */
export interface LobbyPlayer {
  seat: number;
  name: string;
  isHost: boolean;
}

/**
 * Состав комнаты ДО старта (2.2.a-1) — рассылается всем в комнате при каждом изменении состава.
 * Клиент рисует лобби (список, кто хозяин) и кнопку Start (активна у хозяина при `canStart`).
 */
export interface LobbyPayload {
  roomId: string;
  players: LobbyPlayer[];
  capacity: number;
  /** Можно ли уже стартовать (игроков ≥ минимума). Кнопку Start гейтит хозяин по этому флагу. */
  canStart: boolean;
}

/**
 * Снимок авторитетного состояния (ADR-0013). Клиент применяет, ТОЛЬКО если `stateVersion`
 * больше уже применённой. `state` — публичное (без `seed`/`rng`). `events` едут вместе со
 * своим состоянием, чтобы одиночные события (`combo:yahtzee`) не терялись между апдейтами.
 */
export interface StatePayload {
  stateVersion: number;
  state: PublicGameState;
  events: DomainEvent[];
}

/**
 * Присутствие в ИДУЩЕЙ партии (2.2.d-2): список `playerId` с живым сокетом. Рассылается в комнату при
 * изменении состава соединений во время партии (disconnect/reclaim). Клиент: если в `connected` нет
 * НИКОГО, кроме своего id → остался один (соперник вышел) → баннер. БЕЗ forfeit (авто-победа/таймеры — 2.4.c).
 */
export interface PresencePayload {
  connected: string[];
}

/** Отказ в действии — unicast автору (не в общий поток комнаты). */
export interface DeniedPayload {
  reason: string;
  actionId?: string;
}
