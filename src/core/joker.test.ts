import { describe, it, expect } from 'vitest';
import { createGame, reduce } from './game';
import { scoreCategoryWithJoker } from './scoring';
import type { Category, DieValue, GameState, ScoreCard } from './types';

/** Состояние, где у активного игрока (0) заданные кости (уже брошены) и карточка. */
function stateWith(values: number[], card: ScoreCard): GameState {
  const g = createGame([{ name: 'A' }, { name: 'B' }], 1);
  return {
    ...g,
    dice: values.map((v) => ({ value: v as DieValue, held: false })),
    rolledThisTurn: true,
    rollsLeft: 1,
    players: g.players.map((p, i) => (i === 0 ? { ...p, card } : p)),
  };
}

const five = (v: number): number[] => [v, v, v, v, v];

describe('scoreCategoryWithJoker', () => {
  const d = five(3) as DieValue[];
  it('при джокере нижние комбинации засчитываются по полной', () => {
    expect(scoreCategoryWithJoker(d, 'fullHouse', true)).toBe(25);
    expect(scoreCategoryWithJoker(d, 'smallStraight', true)).toBe(30);
    expect(scoreCategoryWithJoker(d, 'largeStraight', true)).toBe(40);
  });
  it('без джокера те же комбинации = 0 (пять одинаковых их не образуют)', () => {
    expect(scoreCategoryWithJoker(d, 'fullHouse', false)).toBe(0);
    expect(scoreCategoryWithJoker(d, 'smallStraight', false)).toBe(0);
    expect(scoreCategoryWithJoker(d, 'largeStraight', false)).toBe(0);
  });
  it('верхние и числовые категории не зависят от джокера', () => {
    expect(scoreCategoryWithJoker(d, 'threes', true)).toBe(15);
    expect(scoreCategoryWithJoker(d, 'chance', true)).toBe(15);
  });
});

describe('бонусные Yahtzee и джокер в reduce(SCORE)', () => {
  it('первый Yahtzee в бокс yahtzee = 50, без бонуса', () => {
    const s = stateWith(five(5), {});
    const r = reduce(s, { type: 'SCORE', category: 'yahtzee' });
    expect(r.state.players[0].card.yahtzee).toBe(50);
    expect(r.state.players[0].bonusYahtzees).toBe(0);
    expect(r.events).toContainEqual({ type: 'combo:yahtzee', player: 0, bonus: false });
  });

  it('повторный Yahtzee при занятом боксе (=50) даёт +100 и джокер-запись в верхнюю', () => {
    const s = stateWith(five(3), { yahtzee: 50 });
    const r = reduce(s, { type: 'SCORE', category: 'threes' });
    expect(r.state.players[0].card.threes).toBe(15);
    expect(r.state.players[0].bonusYahtzees).toBe(1);
    expect(r.events).toContainEqual({ type: 'combo:yahtzee', player: 0, bonus: true });
  });

  it('бонусный Yahtzee в нижнюю секцию по правилу джокера (Full House = 25)', () => {
    const s = stateWith(five(3), { yahtzee: 50, threes: 15 });
    const r = reduce(s, { type: 'SCORE', category: 'fullHouse' });
    expect(r.state.players[0].card.fullHouse).toBe(25);
    expect(r.state.players[0].bonusYahtzees).toBe(1);
  });

  it('если бокс yahtzee записан нулём — бонуса НЕТ, но джокер-запись работает', () => {
    const s = stateWith(five(2), { yahtzee: 0 });
    const r = reduce(s, { type: 'SCORE', category: 'largeStraight' });
    expect(r.state.players[0].card.largeStraight).toBe(40); // джокер
    expect(r.state.players[0].bonusYahtzees).toBe(0); // без бонуса
    expect(r.events).toContainEqual({ type: 'combo:yahtzee', player: 0, bonus: false });
  });

  it('не-Yahtzee бросок не даёт ни бонуса, ни джокера', () => {
    const s = stateWith([1, 2, 3, 4, 5], { yahtzee: 50 });
    const r = reduce(s, { type: 'SCORE', category: 'fullHouse' as Category });
    expect(r.state.players[0].card.fullHouse).toBe(0);
    expect(r.state.players[0].bonusYahtzees).toBe(0);
    expect(r.events.some((e) => e.type === 'combo:yahtzee')).toBe(false);
  });
});
