import { describe, it, expect } from 'vitest';
import { createGame, type DieValue, type GameState } from '../core';
import { bestPreviewCategories } from './scoreView';

/** Состояние «после броска» с заданными костями (презентационная проверка F6.5). */
function rolled(values: DieValue[]): GameState {
  const base = createGame([{ name: 'A' }], 1);
  return { ...base, rolledThisTurn: true, dice: values.map((v) => ({ value: v, held: false })) };
}

describe('bestPreviewCategories (F6.5)', () => {
  it('пусто до броска', () => {
    const fresh = createGame([{ name: 'A' }], 1); // rolledThisTurn=false
    expect(bestPreviewCategories(fresh).size).toBe(0);
  });

  it('один максимум: фул-хаус выгоднее тройки/шанса', () => {
    const best = bestPreviewCategories(rolled([3, 3, 3, 6, 6])); // fullHouse 25 > threeKind/chance 21
    expect([...best]).toEqual(['fullHouse']);
  });

  it('Yahtzee — единственный максимум (50)', () => {
    const best = bestPreviewCategories(rolled([5, 5, 5, 5, 5]));
    expect([...best]).toEqual(['yahtzee']);
  });

  it('ничья максимума: возвращаются все равные лидеры', () => {
    // 4,4,4,4,2 → threeKind=fourKind=chance=18 (сумма всех), это общий максимум
    const best = bestPreviewCategories(rolled([4, 4, 4, 4, 2]));
    expect(best).toEqual(new Set(['threeKind', 'fourKind', 'chance']));
  });
});
