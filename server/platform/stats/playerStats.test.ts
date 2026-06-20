import { describe, it, expect } from 'vitest';
import { computeStats } from './playerStats';

describe('computeStats — личная статистика (null-логика)', () => {
  it('0 партий → winRate null, bestTotal null (без NaN/деления на ноль)', () => {
    expect(computeStats(0, 0, null)).toEqual({
      gamesPlayed: 0,
      wins: 0,
      winRate: null,
      bestTotal: null,
    });
  });

  it('2 сыграно, 1 победа → 50%', () => {
    expect(computeStats(2, 1, 250)).toEqual({
      gamesPlayed: 2,
      wins: 1,
      winRate: 0.5,
      bestTotal: 250,
    });
  });

  it('все победы → 100%', () => {
    expect(computeStats(3, 3, 312)).toEqual({
      gamesPlayed: 3,
      wins: 3,
      winRate: 1,
      bestTotal: 312,
    });
  });

  it('ни одной победы → 0% (но не null — партии были)', () => {
    expect(computeStats(4, 0, 180)).toEqual({
      gamesPlayed: 4,
      wins: 0,
      winRate: 0,
      bestTotal: 180,
    });
  });
});
