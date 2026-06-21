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
 *
 * v4 (2.5): открытые/дежурные столы + «стол переживает партию». 2.5.a-1 добавляет `room:reset`
 * (партия завершилась → стол возвращается в лобби, для open/persistent; клиент гасит состояние,
 * НЕ роняя сокет). Дальнейшие сообщения 2.5 (ready-up, joinOpen, список столов) — в этой же v4.
 *
 * v5 (2.4.c-1): реконнект-арбитраж. Reclaim места теперь по СЕКРЕТНОМУ `reconnectToken`
 * (`JoinedPayload.reconnectToken`, шлётся владельцу; в запросах `JoinRequest`/`JoinOpenRequest`
 * вместо публичного `playerId`), а не по угадываемому `playerId` (ADR-0010). Добавлен `room:gone` —
 * ответ на reclaim в исчезнувшую/сброшенную/завершённую комнату (клиент: «партия завершена», не
 * вечная загрузка). `playerId` остаётся публичным для авторизации хода/presence.
 */
import type { Category, DomainEvent, PublicGameState } from '../src/core';

export const PROTOCOL_VERSION = 5;

/** Имена сокет-сообщений (одна точка истины для клиента и сервера). */
export const MSG = {
  // клиент -> сервер
  create: 'room:create',
  join: 'room:join',
  joinOpen: 'room:joinOpen', // вход в открытый/дежурный стол по публичному id из списка (ADR-0017)
  start: 'room:start',
  ready: 'room:ready', // тоггл готовности места (ADR-0016, ready-up в open/persistent)
  playAgain: 'room:playAgain', // реванш: сброс открытого/дежурного стола в лобби после партии (2.5.d-3b)
  kick: 'room:kick', // хозяин выгоняет игрока из лобби (2.2.c-1)
  action: 'action',
  // сервер -> клиент
  joined: 'room:joined',
  lobby: 'room:lobby',
  reset: 'room:reset', // партия завершилась → стол вернулся в лобби (ADR-0016, open/persistent)
  full: 'room:full',
  notFound: 'room:not-found',
  alreadyStarted: 'room:already-started',
  kicked: 'room:kicked', // тебя выгнал хозяин (2.2.c-1) — unicast жертве
  presence: 'room:presence', // кто на живом сокете в идущей партии (2.2.d-2): оставшийся один → баннер
  nicknameRequired: 'room:nickname-required', // залогиненный без ника просит вход → нужен онбординг (2.3.e-2b)
  gone: 'room:gone', // reclaim в исчезнувшую/сброшенную/завершённую комнату (2.4.c-1) — «партия завершена»
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

/** Запрос на создание комнаты (2.2.a-1; `open` — 2.5.d): сервер генерирует код и сажает автора. */
export interface CreateRequest {
  name?: string;
  /** Открытый стол (ADR-0017): в публичном списке, вход без кода, старт по готовности. Иначе приватный. */
  open?: boolean;
  /** Название открытого стола (для списка); сервер чистит `normalizeName`, дефолт — из имени создателя. */
  title?: string;
}

/** Запрос на вход в комнату по коду (2.2.a-1). `roomId` несёт КОД (сервер его нормализует). */
export interface JoinRequest {
  roomId: string;
  name?: string;
  /**
   * Reclaim места при РЕконнекте (ADR-0010, 2.4.c-1): вернувшийся клиент называет свой СЕКРЕТНЫЙ
   * `reconnectToken` (выдан сервером в `JoinedPayload` при входе) — сервер возвращает его в удерживаемое
   * место идущей партии. Токен непубличный (в отличие от `playerId`) → чужой со ссылкой место не займёт.
   * Первый вход — без поля. Если место/комнаты уже нет — сервер отвечает `room:gone`.
   */
  reconnectToken?: string;
}

/**
 * Вход в ОТКРЫТЫЙ/дежурный стол по публичному id из списка (ADR-0017, 2.5.d): без секретного кода и без
 * анти-перебора. `playerId` — reclaim при реконнекте (d-1b). Приватные комнаты этим путём не входятся.
 */
export interface JoinOpenRequest {
  tableId: string;
  name?: string;
  /** Reclaim по секретному токену при реконнекте (2.4.c-1; см. `JoinRequest.reconnectToken`). */
  reconnectToken?: string;
}

/** Хозяин выгоняет игрока из лобби (2.2.c-1): `seat` — индекс места жертвы в текущем составе лобби. */
export interface KickRequest {
  seat: number;
}

/** Тоггл готовности своего места (ADR-0016, ready-up в open/persistent). Авто-старт — когда все готовы. */
export interface ReadyRequest {
  ready: boolean;
}

/** Подтверждение посадки: стабильный `playerId` места (для авторизации действий), индекс и роль. */
export interface JoinedPayload {
  roomId: string;
  playerId: string;
  seat: number;
  /** Хозяин ли это место (создатель комнаты). Хозяин запускает партию кнопкой Start (2.2). */
  isHost: boolean;
  /**
   * СЕКРЕТНЫЙ токен реконнекта этого места (2.4.c-1, ADR-0010): клиент хранит его и присылает в
   * `reconnectToken` при реконнекте, чтобы вернуться на своё место. Непубличный — другим НЕ рассылается.
   */
  reconnectToken: string;
}

/** Reclaim не удался — комнаты/места/партии уже нет (2.4.c-1): клиент показывает «партия завершена». */
export interface GonePayload {
  roomId: string;
}

/** Один игрок в составе лобби (до старта партии): место, имя, роль, готовность. */
export interface LobbyPlayer {
  seat: number;
  name: string;
  isHost: boolean;
  /** Отметился «готов» (ADR-0016, ready-up в open/persistent). В приватном лобби не используется. */
  ready: boolean;
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

/**
 * Стол вернулся в лобби после завершившейся партии (ADR-0016, реванш) — для open/persistent. Клиент
 * по этому сигналу гасит состояние игры (НЕ роняя сокет/playerId/комнату) и возвращается в лобби;
 * актуальный состав придёт следом в `room:lobby`. Приватные комнаты это сообщение не получают.
 */
export interface ResetPayload {
  roomId: string;
}

/** Статус стола в публичном списке (2.5.d): ждёт игроков / идёт партия / заполнен. */
export type TableStatus = 'waiting' | 'in-game' | 'full';

/**
 * Публичная карточка стола для `GET /tables` (ADR-0017): ТОЛЬКО open/persistent, ТОЛЬКО агрегаты — без
 * имён игроков и без секретных кодов приватных комнат. `tableId` — публичный id для входа (joinOpen).
 */
export interface OpenTable {
  tableId: string;
  title: string;
  count: number;
  capacity: number;
  status: TableStatus;
}

/**
 * Строка публичного лидерборда (2.4.a, ADR-0018): ТОЛЬКО ник+аватар+агрегаты честных сетевых партий
 * (≥2 разных зарегистрированных). Без email/Google-id/имён гостей/кодов. Сортировка — по `points`.
 */
export interface LeaderboardRow {
  nickname: string;
  avatarUrl: string | null;
  points: number; // сумма total за все зачётные партии
  best: number; // лучший total за партию
  played: number; // сыграно зачётных партий
  wins: number; // побед (членство в winnerIds; ничья засчитана обоим)
}
