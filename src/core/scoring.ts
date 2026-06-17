/**
 * Подсчёт очков Yahtzee (F1, под-шаг 1). Чистые функции над значениями костей.
 * Бонусные Yahtzee и правило джокера обрабатываются в игровом reducer (F1.3),
 * здесь — базовый счёт категорий и итог игрока.
 */
import {
  CATEGORIES,
  UPPER_CATEGORIES,
  UPPER_BONUS,
  UPPER_BONUS_THRESHOLD,
  YAHTZEE_BONUS,
  YAHTZEE_SCORE,
  type Category,
  type DieValue,
  type Player,
  type ScoreCard,
} from './types';

/** Счётчик частот: индексы 1..6 (индекс 0 не используется). */
function counts(dice: DieValue[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}

const sum = (dice: DieValue[]): number => dice.reduce((a, b) => a + b, 0);

function sumOfFace(dice: DieValue[], face: DieValue): number {
  return dice.filter((d) => d === face).length * face;
}

function hasNOfKind(dice: DieValue[], n: number): boolean {
  return counts(dice).some((c) => c >= n);
}

/** Full House = ровно 3+2 разных достоинств. Пять одинаковых — это Yahtzee, не Full House. */
function isFullHouse(dice: DieValue[]): boolean {
  const groups = counts(dice)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  return groups.length === 2 && groups[0] === 2 && groups[1] === 3;
}

/** Есть ли последовательность длиной не меньше len (в любом порядке костей). */
function hasStraight(dice: DieValue[], len: number): boolean {
  const present = new Set(dice);
  let best = 0;
  let cur = 0;
  for (let v = 1; v <= 6; v++) {
    if (present.has(v as DieValue)) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best >= len;
}

/** Является ли бросок Yahtzee (5 одинаковых). */
export function isYahtzee(dice: DieValue[]): boolean {
  return hasNOfKind(dice, 5);
}

/** «Натуральные» очки за категорию для данного броска (без джокера/бонусов). */
export function scoreCategory(dice: DieValue[], cat: Category): number {
  switch (cat) {
    case 'ones':
      return sumOfFace(dice, 1);
    case 'twos':
      return sumOfFace(dice, 2);
    case 'threes':
      return sumOfFace(dice, 3);
    case 'fours':
      return sumOfFace(dice, 4);
    case 'fives':
      return sumOfFace(dice, 5);
    case 'sixes':
      return sumOfFace(dice, 6);
    case 'threeKind':
      return hasNOfKind(dice, 3) ? sum(dice) : 0;
    case 'fourKind':
      return hasNOfKind(dice, 4) ? sum(dice) : 0;
    case 'fullHouse':
      return isFullHouse(dice) ? 25 : 0;
    case 'smallStraight':
      return hasStraight(dice, 4) ? 30 : 0;
    case 'largeStraight':
      return hasStraight(dice, 5) ? 40 : 0;
    case 'yahtzee':
      return isYahtzee(dice) ? YAHTZEE_SCORE : 0;
    case 'chance':
      return sum(dice);
  }
}

/** Сумма верхней секции карточки (для бонуса). */
export function upperSum(card: ScoreCard): number {
  return UPPER_CATEGORIES.reduce((acc, c) => acc + (card[c] ?? 0), 0);
}

/** Верхний бонус: +35, если сумма верхней секции >= 63. */
export function upperBonus(card: ScoreCard): number {
  return upperSum(card) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

/** Итог игрока: сумма категорий + верхний бонус + бонусные Yahtzee (×100). */
export function totalScore(player: Player): number {
  const categorySum = CATEGORIES.reduce((acc, c) => acc + (player.card[c] ?? 0), 0);
  return categorySum + upperBonus(player.card) + player.bonusYahtzees * YAHTZEE_BONUS;
}
