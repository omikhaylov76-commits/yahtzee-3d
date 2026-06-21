/**
 * Авторитетная модель партии в комнате (ADR-0009/0013) — ЧИСТАЯ логика, без сокетов, поэтому
 * тестируема (см. rooms.test.ts). Сетевая обвязка (Socket.IO, посадка на места) — в realtime.ts.
 *
 * Здесь: применение сетевого действия к состоянию комнаты с авторизацией хода, инъекцией
 * CSPRNG-значений костей (ADR-0012), версионированием состояния и идемпотентностью по `actionId`.
 */
import type { ActionMessage, NetworkAction } from '../../shared/protocol';
import { availableCategories, CATEGORIES } from '../../src/core';
import type {
  Action,
  DieValue,
  DomainEvent,
  GameResult,
  GameState,
  PublicGameState,
} from '../../src/core';
import type { GameModule } from './gameModule';

/** Конкретный модуль Yahtzee для платформы (2.1 — одна игра; обобщение платформы — Веха 4). */
export type YahtzeeModule = GameModule<GameState, PublicGameState, Action, DomainEvent, GameResult>;

/** Авторитетное состояние партии в комнате: само состояние ядра + версия + дедуп действий. */
export interface RoomState {
  state: GameState;
  /** Монотонный счётчик на комнату (ADR-0013): клиент применяет только более новое. */
  stateVersion: number;
  /** `actionId`-ы уже применённых действий (идемпотентность; партия коротка, рост ограничен). */
  processed: string[];
}

export interface ApplyResult {
  room: RoomState;
  events: DomainEvent[];
  /** Причина отказа (unicast автору); версия НЕ двигается. */
  denied?: string;
  /** Повтор уже обработанного `actionId` — состояние не менялось, автору шлём текущий снимок. */
  duplicate?: boolean;
}

/** Старт партии: места (id+имена) задаёт платформа; версия с 1. */
export function startGame(
  module: YahtzeeModule,
  players: { id: string; name: string }[],
  seed?: number,
): RoomState {
  return { state: module.createInitialState(players, seed), stateVersion: 1, processed: [] };
}

/**
 * Структурная проверка конверта действия С ПРОВОДА (по сети приходит `any`, ADR-0013 — граница
 * безопасности): кривой пакет не должен ронять обработчик и не должен обходить дедуп.
 */
function isActionMessage(msg: unknown): msg is ActionMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.actionId !== 'string' || m.actionId.length === 0) return false;
  if (typeof m.action !== 'object' || m.action === null) return false;
  return typeof (m.action as Record<string, unknown>).type === 'string';
}

/**
 * Сетевое действие -> ядровое, С ВАЛИДАЦИЕЙ ПОЛЕЙ (ядро неприкосновенно, поэтому мусор отсекаем
 * здесь). `ROLL` получает значения из CSPRNG сервера (клиент их не задаёт). Невалидное поле или
 * запрещённый тип (напр. `NEW_GAME` — партию создаёт только сервер) -> `null` (=> `bad-action`).
 */
function toCoreAction(a: NetworkAction, rollValues: () => DieValue[]): Action | null {
  switch (a.type) {
    case 'ROLL':
      return { type: 'ROLL', values: rollValues() };
    case 'TOGGLE_HOLD':
      return Number.isInteger(a.index) ? { type: 'TOGGLE_HOLD', index: a.index } : null;
    case 'SCORE':
      // Неизвестная категория с провода иначе пишет мусор в карточку и проматывает ход (анти-чит).
      return (CATEGORIES as readonly string[]).includes(a.category)
        ? { type: 'SCORE', category: a.category }
        : null;
    default:
      return null;
  }
}

function isDenied(e: DomainEvent): e is Extract<DomainEvent, { type: 'action:denied' }> {
  return e.type === 'action:denied';
}

/** Пометить `actionId` обработанным без смены состояния (отказ остаётся идемпотентным). */
function rejected(room: RoomState, actionId: string, reason: string): ApplyResult {
  return {
    room: { ...room, processed: [...room.processed, actionId] },
    events: [],
    denied: reason,
  };
}

/**
 * Применить сетевое действие к комнате авторитетно (ADR-0013):
 * 1) повтор `actionId` -> идемпотентно (duplicate); 2) запрещённый тип -> denied; 3) не свой ход
 * -> denied; 4) отказ правил ядра -> denied (версию не двигаем); 5) успех -> новое состояние,
 * `stateVersion+1`, события наружу.
 */
export function applyNetworkAction(
  module: YahtzeeModule,
  room: RoomState,
  actorId: string,
  msg: unknown,
  rollValues: () => DieValue[],
): ApplyResult {
  // Кривой/неполный пакет с провода: отказ без касания состояния (не можем дедупить без actionId).
  if (!isActionMessage(msg)) {
    return { room, events: [], denied: 'bad-action' };
  }
  if (room.processed.includes(msg.actionId)) {
    return { room, events: [], duplicate: true };
  }

  const coreAction = toCoreAction(msg.action, rollValues);
  if (!coreAction) {
    return rejected(room, msg.actionId, 'bad-action');
  }
  if (!module.isPlayersTurn(room.state, actorId)) {
    return rejected(room, msg.actionId, 'not-your-turn');
  }

  const { state, events } = module.reduce(room.state, coreAction);
  const denial = events.find(isDenied);
  if (denial) {
    return rejected(room, msg.actionId, denial.reason);
  }

  return {
    room: {
      state,
      stateVersion: room.stateVersion + 1,
      processed: [...room.processed, msg.actionId],
    },
    events,
  };
}

/**
 * ОДИН авто-ход за ВЫШЕДШЕГО игрока (форфейт, 2.4.c-2; ADR-0009 «выбывший на своём ходу → партия обязана
 * завершаться»). Бросок серверным CSPRNG (`rollValues`) и запись в ПЕРВУЮ свободную категорию текущего
 * игрока — чтобы партия не висла на ходу отсутствующего и гарантированно дошла до `game:over`. Идёт через
 * тот же `applyNetworkAction` (авторизация хода/версии/идемпотентность), поэтому `actorId` обязан быть
 * id игрока, чей сейчас ход. `actionId` минтит сервер (`mintActionId`, инъекция — как `rollValues`): он
 * ДОЛЖЕН быть НЕугадываемым (напр. `randomUUID`), иначе клиент, зная схему `forfeit-<версия>`, заранее
 * засеет `processed[]` тем же id (даже denied-ход «не в свою очередь» пишет actionId в `processed[]`) →
 * авто-ход вернёт `duplicate` без смены версии → каскад зависнет (адверсариальная находка ревью). Если
 * игрок успел бросить до выхода (`rolledThisTurn`), повторно не бросаем. `denied`/`duplicate` пробрасываем
 * наверх — для активного игрока с валидным ходом не наступают (страховка от рассинхрона). Чистая (без сокетов).
 */
export function applyForfeitTurn(
  module: YahtzeeModule,
  room: RoomState,
  actorId: string,
  rollValues: () => DieValue[],
  mintActionId: () => string,
): ApplyResult {
  let cur = room;
  const events: DomainEvent[] = [];
  // SCORE требует брошенных костей (иначе `score-before-roll`); если игрок уже бросал до выхода — не бросаем.
  if (!cur.state.rolledThisTurn) {
    const rolled = applyNetworkAction(
      module,
      cur,
      actorId,
      { action: { type: 'ROLL' }, actionId: mintActionId() },
      rollValues,
    );
    if (rolled.denied || rolled.duplicate) return rolled; // не его ход / рассинхрон — наверх (каскад встанет)
    cur = rolled.room;
    events.push(...rolled.events);
  }
  // У активного игрока свободная категория всегда есть (иначе ход бы уже ушёл). Страховка от пустого списка.
  const category = availableCategories(cur.state)[0];
  if (!category) return { room: cur, events, denied: 'no-free-category' };
  const scored = applyNetworkAction(
    module,
    cur,
    actorId,
    { action: { type: 'SCORE', category }, actionId: mintActionId() },
    rollValues,
  );
  return {
    room: scored.room,
    events: [...events, ...scored.events],
    denied: scored.denied,
    duplicate: scored.duplicate,
  };
}
