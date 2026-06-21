/**
 * Юниты решения о записи (2.3.d-2): триггер по `game:over`, guard «≥1 зарегистрированный», проброс промаха места.
 */
import { describe, it, expect } from 'vitest';
import { rowsForCompletedGame } from './onGameOver';
import type { MatchResult } from '../gameModule';

const result: MatchResult = {
  winnerIds: ['p1'],
  standings: [
    { id: 'p1', name: 'A', total: 200 },
    { id: 'p2', name: 'B', total: 150 },
  ],
};
const regSeats = [
  { playerId: 'p1', userId: 'u1' },
  { playerId: 'p2', userId: 'u2' },
];

describe('rowsForCompletedGame', () => {
  it('нет game:over в событиях → null (партия ещё идёт)', () => {
    expect(
      rowsForCompletedGame([{ type: 'score:applied' }], result, regSeats, 'yahtzee', false),
    ).toBeNull();
  });

  it('game:over + ≥1 зарегистрированный → строки', () => {
    const rows = rowsForCompletedGame([{ type: 'game:over' }], result, regSeats, 'yahtzee', false);
    expect(rows).not.toBeNull();
    expect(rows?.match.registeredCount).toBe(2);
    expect(rows?.players).toHaveLength(2);
  });

  it('game:over, но только гости → null (в историю/рейтинг не пишем)', () => {
    const guests = [
      { playerId: 'p1', userId: null },
      { playerId: 'p2', userId: null },
    ];
    expect(
      rowsForCompletedGame([{ type: 'game:over' }], result, guests, 'yahtzee', false),
    ).toBeNull();
  });

  it('forfeited=true → null, даже при game:over и зарегистрированных (доиграно за ушедшего, ADR-0018)', () => {
    expect(
      rowsForCompletedGame([{ type: 'game:over' }], result, regSeats, 'yahtzee', true),
    ).toBeNull();
  });

  it('промах места (forfeit-сценарий) → onMissingSeat вызван, без падения', () => {
    const missing: string[] = [];
    rowsForCompletedGame(
      [{ type: 'game:over' }],
      result,
      [{ playerId: 'p1', userId: 'u1' }],
      'yahtzee',
      false,
      (id) => missing.push(id),
    );
    expect(missing).toEqual(['p2']);
  });
});
