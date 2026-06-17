/**
 * Ядро игры (F1) — типы состояния, действий и доменных событий.
 * Чистый TypeScript: НИ React, НИ 3D, НИ звука, НИ DOM. См. docs/architecture.md и
 * ADR 0003 (Transport/actions/events), ADR 0004 (значения костей определяет ядро).
 */

/** 13 категорий Yahtzee в каноническом порядке. */
export const CATEGORIES = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yahtzee',
  'chance',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Верхняя секция (для бонуса +35 при сумме >= 63). */
export const UPPER_CATEGORIES = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;
export type UpperCategory = (typeof UPPER_CATEGORIES)[number];

export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

/** Одна кость: выпавшее значение + зафиксирована ли (отложена от переброса). */
export interface Die {
  value: DieValue;
  held: boolean;
}

/** Карточка счёта игрока: записанные категории -> очки (в т.ч. 0). */
export type ScoreCard = Partial<Record<Category, number>>;

export interface Player {
  id: string;
  name: string;
  card: ScoreCard;
  /** Сколько дополнительных Yahtzee получено (каждый = +100, правила джокера, F1.3). */
  bonusYahtzees: number;
}

export type GamePhase = 'playing' | 'over';

export interface GameState {
  players: Player[];
  /** Индекс активного игрока в players. */
  current: number;
  /** Ровно 5 костей. */
  dice: Die[];
  /** Оставшиеся броски в текущем ходу (3 -> 0). */
  rollsLeft: number;
  /** Был ли хотя бы один бросок в этом ходу (можно ли фиксировать/записывать). */
  rolledThisTurn: boolean;
  phase: GamePhase;
  /** Победитель(и) после конца игры; пусто во время игры. Ничья -> несколько индексов. */
  winnerIds: number[];
  /** Сид RNG (для воспроизводимости и будущей сети, ADR 0003/0004). */
  seed: number;
  /** Текущее состояние ГПСЧ — держим в state, чтобы reduce был чистым. */
  rng: number;
  /** Задел под сеть (ADR 0003): идентификатор партии. */
  gameId?: string;
}

/** Пороговые значения правил. */
export const UPPER_BONUS = 35;
export const UPPER_BONUS_THRESHOLD = 63;
export const YAHTZEE_SCORE = 50;
export const YAHTZEE_BONUS = 100;

/** Действия — единственный вход в ядро (ADR 0003). */
export type Action =
  | { type: 'NEW_GAME'; players: { name: string }[]; seed?: number }
  | { type: 'ROLL' }
  | { type: 'TOGGLE_HOLD'; index: number }
  | { type: 'SCORE'; category: Category };

/** Доменные события — выход ядра для слоёв звука/сочности (они не лезут в правила). */
export type DomainEvent =
  | { type: 'dice:rolled' }
  | { type: 'die:held'; index: number }
  | { type: 'die:released'; index: number }
  | { type: 'score:written'; player: number; category: Category; points: number }
  | { type: 'action:denied'; reason: string }
  | { type: 'combo:yahtzee'; player: number; bonus: boolean }
  | { type: 'turn:changed'; player: number }
  | { type: 'game:over'; winnerIds: number[] };

/** Результат reduce: новое состояние + список событий, произошедших при переходе. */
export interface ReduceResult {
  state: GameState;
  events: DomainEvent[];
}
