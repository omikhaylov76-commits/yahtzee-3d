import { describe, it, expect } from 'vitest';
import { scoreCategory, isYahtzee, upperSum, upperBonus, totalScore } from './scoring';
import type { DieValue, Player, ScoreCard } from './types';

const d = (...vals: number[]): DieValue[] => vals as DieValue[];

describe('scoreCategory — верхняя секция', () => {
  it('считает сумму нужного достоинства', () => {
    expect(scoreCategory(d(1, 1, 2, 3, 1), 'ones')).toBe(3);
    expect(scoreCategory(d(2, 2, 2, 5, 6), 'twos')).toBe(6);
    expect(scoreCategory(d(6, 6, 6, 6, 6), 'sixes')).toBe(30);
    expect(scoreCategory(d(1, 2, 3, 4, 5), 'sixes')).toBe(0);
  });
});

describe('scoreCategory — нижняя секция', () => {
  it('three of a kind = сумма всех костей при 3+ одинаковых, иначе 0', () => {
    expect(scoreCategory(d(3, 3, 3, 4, 5), 'threeKind')).toBe(18);
    expect(scoreCategory(d(3, 3, 4, 4, 5), 'threeKind')).toBe(0);
  });

  it('four of a kind = сумма всех при 4+ одинаковых, иначе 0', () => {
    expect(scoreCategory(d(5, 5, 5, 5, 2), 'fourKind')).toBe(22);
    expect(scoreCategory(d(5, 5, 5, 2, 2), 'fourKind')).toBe(0);
  });

  it('full house = 25 только при 3+2; пять одинаковых НЕ фулл-хаус', () => {
    expect(scoreCategory(d(3, 3, 3, 6, 6), 'fullHouse')).toBe(25);
    expect(scoreCategory(d(2, 2, 5, 5, 5), 'fullHouse')).toBe(25);
    expect(scoreCategory(d(4, 4, 4, 4, 4), 'fullHouse')).toBe(0);
    expect(scoreCategory(d(1, 2, 3, 4, 5), 'fullHouse')).toBe(0);
  });

  it('small straight = 30 при 4 подряд (любой порядок)', () => {
    expect(scoreCategory(d(1, 2, 3, 4, 6), 'smallStraight')).toBe(30);
    expect(scoreCategory(d(4, 1, 3, 2, 1), 'smallStraight')).toBe(30);
    expect(scoreCategory(d(2, 3, 4, 5, 5), 'smallStraight')).toBe(30);
    expect(scoreCategory(d(1, 2, 3, 5, 6), 'smallStraight')).toBe(0);
  });

  it('large straight = 40 при 5 подряд', () => {
    expect(scoreCategory(d(1, 2, 3, 4, 5), 'largeStraight')).toBe(40);
    expect(scoreCategory(d(2, 3, 4, 5, 6), 'largeStraight')).toBe(40);
    expect(scoreCategory(d(5, 4, 3, 2, 6), 'largeStraight')).toBe(40);
    expect(scoreCategory(d(1, 2, 3, 4, 6), 'largeStraight')).toBe(0);
  });

  it('yahtzee = 50 при 5 одинаковых, иначе 0', () => {
    expect(scoreCategory(d(4, 4, 4, 4, 4), 'yahtzee')).toBe(50);
    expect(scoreCategory(d(4, 4, 4, 4, 5), 'yahtzee')).toBe(0);
  });

  it('chance = сумма всех костей', () => {
    expect(scoreCategory(d(1, 2, 3, 4, 5), 'chance')).toBe(15);
    expect(scoreCategory(d(6, 6, 6, 6, 6), 'chance')).toBe(30);
  });
});

describe('isYahtzee', () => {
  it('распознаёт 5 одинаковых', () => {
    expect(isYahtzee(d(2, 2, 2, 2, 2))).toBe(true);
    expect(isYahtzee(d(2, 2, 2, 2, 3))).toBe(false);
  });
});

describe('верхний бонус и итог', () => {
  it('upperSum суммирует только верхнюю секцию', () => {
    const card: ScoreCard = { ones: 3, twos: 6, sixes: 18, chance: 20, yahtzee: 50 };
    expect(upperSum(card)).toBe(27);
  });

  it('upperBonus = 35 при сумме верха >= 63, иначе 0', () => {
    expect(upperBonus({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 })).toBe(35);
    expect(upperBonus({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 12 })).toBe(0);
  });

  it('totalScore = категории + верхний бонус + бонусные Yahtzee×100', () => {
    const player: Player = {
      id: 'p1',
      name: 'A',
      card: { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18, yahtzee: 50 },
      bonusYahtzees: 2,
    };
    // верх = 63 -> +35; категории = 63 + 50 = 113; бонусы 2*100 = 200
    expect(totalScore(player)).toBe(113 + 35 + 200);
  });

  it('пустая карточка -> 0', () => {
    expect(totalScore({ id: 'p', name: 'B', card: {}, bonusYahtzees: 0 })).toBe(0);
  });
});
