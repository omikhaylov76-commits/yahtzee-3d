/**
 * Контракт платформа↔игра (ADR-0011). Платформа (комнаты/цикл/рассылка) вызывает игру «вслепую»
 * через этот интерфейс; конкретные правила/счёт/секреты знает только игра. Yahtzee — первый и
 * пока единственный модуль (server/games/yahtzee). Не добавляем «крючков на будущие игры» —
 * только то, что нужно сейчас (анти-оверинжиниринг, ADR-0011).
 *
 * Дженерики позволяют платформе не знать конкретных типов игры.
 */
/**
 * Обобщённый итог завершённой партии — ТИПИЗИРОВАННЫЙ контракт шва платформа↔игра (2.3.d, ADR-0011).
 * Платформа хранит/агрегирует его (история партий, статистика кабинета, лидерборд), НЕ зная внутренних
 * типов игры: победители и финальные очки по стабильному playerId места. Каждая игра обязуется отдавать
 * итог в ЭТОЙ форме — поэтому дженерик `Result` ниже ограничен `extends MatchResult`. Так платформенный
 * stats-слой (2.3.d) зависит от `MatchResult` (контракт шва), а НЕ от игрового `src/core` — граница не
 * протекает в сторону платформы. Для Yahtzee core-тип `GameResult` структурно совпадает (проверит компилятор).
 */
export interface MatchResult {
  /** Победитель(и) по стабильному playerId; ничья → несколько. */
  winnerIds: string[];
  /** Итоговая таблица: стабильный id места, имя на момент партии, финальный счёт. */
  standings: { id: string; name: string; total: number }[];
}

export interface GameModule<
  State,
  PublicState,
  Action,
  Event,
  Result extends MatchResult = MatchResult,
> {
  readonly id: string;
  /** Начальное состояние партии. Места (стабильные id + имена) задаёт ПЛАТФОРМА, не игра. */
  createInitialState(players: { id: string; name: string }[], seed?: number): State;
  /** Единственная точка изменения состояния (чистый reducer ядра). */
  reduce(state: State, action: Action): { state: State; events: Event[] };
  /** Авторизация действия: ход ли игрока с данным стабильным id. */
  isPlayersTurn(state: State, playerId: string): boolean;
  isGameOver(state: State): boolean;
  /** Обобщённый итог для статистики/лидерборда (форма зафиксирована контрактом `MatchResult`). */
  getResult(state: State): Result;
  /** Снять секреты (seed/rng) перед рассылкой клиентам (анти-чит, ADR-0009/0012). */
  toPublicState(state: State): PublicState;
}
