/**
 * Юниты чистой раскладки итога в строки БД (2.3.d). БЕЗ БД/сокетов — простые объекты. Покрывают разбор
 * аудита: победитель/ничья, гость→null, registered_count, 3-4 игрока, промах места, game_id из аргумента.
 */
import { describe, it, expect } from 'vitest';
import { buildMatchRows, type SeatRef } from './buildRows';
import type { MatchResult } from '../gameModule';

const seat = (playerId: string, userId: string | null = null): SeatRef => ({ playerId, userId });

describe('buildMatchRows', () => {
  it('помечает победителя, остальных — нет; total/имя из standings; счётчики верны', () => {
    const result: MatchResult = {
      winnerIds: ['p1'],
      standings: [
        { id: 'p1', name: 'Alice', total: 210 },
        { id: 'p2', name: 'Bob', total: 180 },
      ],
    };
    const { match, players } = buildMatchRows(
      result,
      [seat('p1', 'u1'), seat('p2', 'u2')],
      'yahtzee',
    );
    expect(match.gameId).toBe('yahtzee');
    expect(match.playerCount).toBe(2);
    expect(match.registeredCount).toBe(2);
    expect(players).toEqual([
      { userId: 'u1', displayName: 'Alice', total: 210, isWinner: true },
      { userId: 'u2', displayName: 'Bob', total: 180, isWinner: false },
    ]);
  });

  it('ничья → несколько победителей', () => {
    const result: MatchResult = {
      winnerIds: ['p1', 'p2'],
      standings: [
        { id: 'p1', name: 'A', total: 200 },
        { id: 'p2', name: 'B', total: 200 },
      ],
    };
    const { players } = buildMatchRows(result, [seat('p1', 'u1'), seat('p2', 'u2')], 'yahtzee');
    expect(players.every((p) => p.isWinner)).toBe(true);
  });

  it('гость → user_id=null; registered_count считает только аккаунты', () => {
    const result: MatchResult = {
      winnerIds: ['p2'],
      standings: [
        { id: 'p1', name: 'Guest', total: 120 },
        { id: 'p2', name: 'Reg', total: 160 },
      ],
    };
    const { match, players } = buildMatchRows(
      result,
      [seat('p1', null), seat('p2', 'u2')],
      'yahtzee',
    );
    expect(players[0].userId).toBeNull();
    expect(players[1].userId).toBe('u2');
    expect(match.registeredCount).toBe(1);
    expect(match.playerCount).toBe(2);
  });

  it('3-4 игрока смешанные: 1 аккаунт + 2 гостя → registered_count=1, player_count=3', () => {
    const result: MatchResult = {
      winnerIds: ['p1'],
      standings: [
        { id: 'p1', name: 'Reg', total: 240 },
        { id: 'p2', name: 'G2', total: 150 },
        { id: 'p3', name: 'G3', total: 130 },
      ],
    };
    const { match } = buildMatchRows(result, [seat('p1', 'u1'), seat('p2'), seat('p3')], 'yahtzee');
    expect(match.playerCount).toBe(3);
    expect(match.registeredCount).toBe(1);
  });

  it('playerId из standings нет среди мест → user_id=null + onMissingSeat, без throw', () => {
    const result: MatchResult = {
      winnerIds: ['p1'],
      standings: [
        { id: 'p1', name: 'A', total: 200 },
        { id: 'gone', name: 'Left', total: 90 },
      ],
    };
    const missing: string[] = [];
    const { match, players } = buildMatchRows(result, [seat('p1', 'u1')], 'yahtzee', (id) =>
      missing.push(id),
    );
    expect(missing).toEqual(['gone']);
    expect(players[1]).toEqual({ userId: null, displayName: 'Left', total: 90, isWinner: false });
    expect(match.registeredCount).toBe(1);
  });

  it('game_id берётся из аргумента (module.id), не из состояния', () => {
    const result: MatchResult = {
      winnerIds: ['p1'],
      standings: [{ id: 'p1', name: 'A', total: 50 }],
    };
    expect(buildMatchRows(result, [seat('p1', 'u1')], 'chess').match.gameId).toBe('chess');
  });

  it('только гости → строки есть, registered_count=0 (решение «не писать» — у вызывающего)', () => {
    const result: MatchResult = {
      winnerIds: ['p1'],
      standings: [
        { id: 'p1', name: 'G1', total: 100 },
        { id: 'p2', name: 'G2', total: 90 },
      ],
    };
    const { match, players } = buildMatchRows(result, [seat('p1'), seat('p2')], 'yahtzee');
    expect(match.registeredCount).toBe(0);
    expect(players).toHaveLength(2);
  });
});
