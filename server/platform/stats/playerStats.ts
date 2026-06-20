/**
 * Личная статистика игрока (2.3.e-4) — для кабинета (e-5). Источник — `match_players` (история записанных
 * сетевых партий, 2.3.d) по `user_id`. ОДИН агрегат вне горячего пути (запись редка, чтение кэшируемо).
 * Считаем ТОЛЬКО строки этого пользователя (гостевые `user_id=null` — не его). «Сыграно» = доигранные
 * сетевые партии с его участием (брошенные не пишутся). Чистый `computeStats` тестируем без БД.
 */
import { eq, sql } from 'drizzle-orm';

export interface PlayerStats {
  /** Доигранных сетевых партий с участием игрока. */
  gamesPlayed: number;
  /** Из них победных (членство в winnerIds; ничья засчитана обоим — is_winner, 2.3.d). */
  wins: number;
  /** Доля побед [0..1] или null, если партий ещё нет (UI покажет «—», без NaN). */
  winRate: number | null;
  /** Лучший личный счёт в сетевой партии или null, если партий нет. */
  bestTotal: number | null;
}

/** Чистая сборка статистики из сырых агрегатов (null-логика отдельно от SQL — тестируемо). */
export function computeStats(
  gamesPlayed: number,
  wins: number,
  bestTotal: number | null,
): PlayerStats {
  return {
    gamesPlayed,
    wins,
    winRate: gamesPlayed > 0 ? wins / gamesPlayed : null,
    bestTotal,
  };
}

/** Статистика игрока по его `user_id` (один SQL-агрегат). Нет партий → нули + null. */
export async function getPlayerStats(userId: string): Promise<PlayerStats> {
  // Ленивый БД-импорт (как auth/record): чистый computeStats тестируется без DATABASE_URL.
  const { db, schema } = await import('../db');
  const [row] = await db
    .select({
      gamesPlayed: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${schema.matchPlayers.isWinner})::int`,
      bestTotal: sql<number | null>`max(${schema.matchPlayers.total})`,
    })
    .from(schema.matchPlayers)
    .where(eq(schema.matchPlayers.userId, userId));
  return computeStats(row?.gamesPlayed ?? 0, row?.wins ?? 0, row?.bestTotal ?? null);
}
