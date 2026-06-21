/**
 * Тест чистого маппинга лидерборда (2.4.a). SQL-агрегат не тестируем без БД — проверяем проекцию и
 * защитный отсев строк без ника (рассинхрон). Запрос проверяется живьём против БД при деплое.
 */
import { describe, it, expect } from 'vitest';
import { toLeaderboardRows } from './leaderboard';

describe('toLeaderboardRows', () => {
  it('проецирует поля агрегата в публичную строку', () => {
    const out = toLeaderboardRows([
      { nickname: 'Neo', avatarUrl: 'http://a/x.png', points: 540, best: 310, played: 3, wins: 2 },
    ]);
    expect(out).toEqual([
      { nickname: 'Neo', avatarUrl: 'http://a/x.png', points: 540, best: 310, played: 3, wins: 2 },
    ]);
  });

  it('защитно отсекает строки без ника (рассинхрон)', () => {
    const out = toLeaderboardRows([
      { nickname: null, avatarUrl: null, points: 100, best: 100, played: 1, wins: 0 },
      { nickname: 'Trinity', avatarUrl: null, points: 200, best: 200, played: 1, wins: 1 },
    ]);
    expect(out.map((r) => r.nickname)).toEqual(['Trinity']);
  });

  it('пустой вход → пустой список', () => {
    expect(toLeaderboardRows([])).toEqual([]);
  });
});
