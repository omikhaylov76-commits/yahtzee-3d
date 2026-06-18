import { describe, it, expect } from 'vitest';
import { createGame, reduce, isPlayersTurn, isGameOver, getResult, toPublicState } from './game';
import type { DieValue, GameState } from './types';

const g2 = () =>
  createGame(
    [
      { name: 'A', id: 'u1' },
      { name: 'B', id: 'u2' },
    ],
    5,
  );

describe('createGame — внешние id игроков (2.1.a)', () => {
  it('берёт заданные id', () => {
    expect(g2().players.map((p) => p.id)).toEqual(['u1', 'u2']);
  });
  it('фолбэк p${i} без id (обратная совместимость)', () => {
    const s = createGame([{ name: 'A' }, { name: 'B' }]);
    expect(s.players.map((p) => p.id)).toEqual(['p0', 'p1']);
  });
});

describe('ROLL — инъекция значений извне (ADR-0012)', () => {
  it('применяет заданные значения по позиции', () => {
    const { state } = reduce(g2(), { type: 'ROLL', values: [2, 3, 4, 5, 6] });
    expect(state.dice.map((d) => d.value)).toEqual([2, 3, 4, 5, 6]);
    expect(state.rollsLeft).toBe(2);
    expect(state.rolledThisTurn).toBe(true);
  });

  it('уважает held: отложенная кость сохраняется', () => {
    let s = g2();
    s = reduce(s, { type: 'ROLL', values: [2, 3, 4, 5, 6] }).state;
    s = reduce(s, { type: 'TOGGLE_HOLD', index: 0 }).state; // фиксируем кость 0 (=2)
    s = reduce(s, { type: 'ROLL', values: [1, 1, 1, 1, 1] }).state;
    expect(s.dice[0].value).toBe(2); // held сохранилась
    expect(s.dice.slice(1).map((d) => d.value)).toEqual([1, 1, 1, 1]);
  });

  it('невалидные values → denied, состояние не меняется', () => {
    const s = g2();
    const shortLen = reduce(s, { type: 'ROLL', values: [1, 2, 3] as DieValue[] });
    expect(shortLen.state).toBe(s);
    expect(shortLen.events).toEqual([{ type: 'action:denied', reason: 'bad-roll-values' }]);

    const outOfRange = reduce(s, { type: 'ROLL', values: [1, 2, 3, 4, 7 as DieValue] });
    expect(outOfRange.events[0]).toMatchObject({
      type: 'action:denied',
      reason: 'bad-roll-values',
    });
  });

  it('без values → прежний RNG-путь (детерминирован по seed)', () => {
    const a = reduce(g2(), { type: 'ROLL' }).state.dice.map((d) => d.value);
    const b = reduce(g2(), { type: 'ROLL' }).state.dice.map((d) => d.value);
    expect(a).toEqual(b);
  });
});

describe('isPlayersTurn / isGameOver', () => {
  it('ход принадлежит текущему игроку по id', () => {
    const s = g2(); // current=0 → u1
    expect(isPlayersTurn(s, 'u1')).toBe(true);
    expect(isPlayersTurn(s, 'u2')).toBe(false);
  });
  it('после конца игры — ничей ход', () => {
    const over: GameState = { ...g2(), phase: 'over' };
    expect(isPlayersTurn(over, 'u1')).toBe(false);
    expect(isGameOver(over)).toBe(true);
    expect(isGameOver(g2())).toBe(false);
  });
});

describe('getResult — итог по стабильному id', () => {
  it('победители и места', () => {
    const base = g2();
    const players = [
      { ...base.players[0], card: { chance: 20 } },
      { ...base.players[1], card: { chance: 10 } },
    ];
    const state: GameState = { ...base, players, phase: 'over', winnerIds: [0] };
    const r = getResult(state);
    expect(r.winnerIds).toEqual(['u1']);
    expect(r.standings).toEqual([
      { id: 'u1', name: 'A', total: 20 },
      { id: 'u2', name: 'B', total: 10 },
    ]);
  });
});

describe('toPublicState — без секретов RNG', () => {
  it('нет seed/rng, публичные поля на месте', () => {
    const s = g2();
    const pub = toPublicState(s);
    expect('seed' in pub).toBe(false);
    expect('rng' in pub).toBe(false);
    expect(pub.players).toBe(s.players);
    expect(pub.current).toBe(s.current);
    expect(pub.phase).toBe('playing');
  });
});
