/**
 * Контракт платформа↔игра (ADR-0011). Платформа (комнаты/цикл/рассылка) вызывает игру «вслепую»
 * через этот интерфейс; конкретные правила/счёт/секреты знает только игра. Yahtzee — первый и
 * пока единственный модуль (server/games/yahtzee). Не добавляем «крючков на будущие игры» —
 * только то, что нужно сейчас (анти-оверинжиниринг, ADR-0011).
 *
 * Дженерики позволяют платформе не знать конкретных типов игры.
 */
export interface GameModule<State, PublicState, Action, Event, Result> {
  readonly id: string;
  /** Начальное состояние партии. Места (стабильные id + имена) задаёт ПЛАТФОРМА, не игра. */
  createInitialState(players: { id: string; name: string }[], seed?: number): State;
  /** Единственная точка изменения состояния (чистый reducer ядра). */
  reduce(state: State, action: Action): { state: State; events: Event[] };
  /** Авторизация действия: ход ли игрока с данным стабильным id. */
  isPlayersTurn(state: State, playerId: string): boolean;
  isGameOver(state: State): boolean;
  /** Обобщённый итог для статистики/лидерборда. */
  getResult(state: State): Result;
  /** Снять секреты (seed/rng) перед рассылкой клиентам (анти-чит, ADR-0009/0012). */
  toPublicState(state: State): PublicState;
}
