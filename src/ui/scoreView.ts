/**
 * Презентационные хелперы поверх ядра для таблицы счёта (F3.4). НЕ дублируют правила —
 * переиспользуют функции ядра (scoreCategoryWithJoker/isYahtzee/upperSum/...). Только то,
 * что нужно UI: подписи, секции, превью очков текущего броска, суммы/бонусы.
 */
import {
  UPPER_CATEGORIES,
  UPPER_BONUS,
  UPPER_BONUS_THRESHOLD,
  isYahtzee,
  scoreCategoryWithJoker,
  upperBonus,
  upperSum,
  totalScore,
  type Category,
  type DieValue,
  type GameState,
  type Player,
} from '../core';

export const CATEGORY_LABELS: Record<Category, string> = {
  ones: 'Ones',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  threeKind: 'Three of a kind',
  fourKind: 'Four of a kind',
  fullHouse: 'Full house',
  smallStraight: 'Small straight',
  largeStraight: 'Large straight',
  yahtzee: 'Yahtzee',
  chance: 'Chance',
};

export const UPPER: Category[] = [...UPPER_CATEGORIES];
export const LOWER: Category[] = [
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yahtzee',
  'chance',
];

export { UPPER_BONUS, UPPER_BONUS_THRESHOLD };

function diceValuesOf(state: GameState): DieValue[] {
  return state.dice.map((d) => d.value);
}

/** Активен ли джокер для игрока при текущих костях (для корректного превью). */
function jokerActiveFor(player: Player, values: DieValue[]): boolean {
  return isYahtzee(values) && player.card.yahtzee !== undefined;
}

/**
 * Превью очков для категории у АКТИВНОГО игрока: число, если категорию можно записать
 * прямо сейчас (был бросок и она свободна), иначе null.
 */
export function previewFor(state: GameState, category: Category): number | null {
  if (state.phase !== 'playing' || !state.rolledThisTurn) return null;
  const player = state.players[state.current];
  if (category in player.card) return null;
  const values = diceValuesOf(state);
  return scoreCategoryWithJoker(values, category, jokerActiveFor(player, values));
}

/** Записанное значение категории у игрока (или undefined). */
export function recorded(player: Player, category: Category): number | undefined {
  return player.card[category];
}

export interface PlayerTotals {
  upper: number;
  bonus: number;
  yahtzeeBonus: number;
  total: number;
}

export function totalsFor(player: Player): PlayerTotals {
  return {
    upper: upperSum(player.card),
    bonus: upperBonus(player.card),
    yahtzeeBonus: player.bonusYahtzees * 100,
    total: totalScore(player),
  };
}
