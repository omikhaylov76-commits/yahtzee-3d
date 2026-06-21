/**
 * Публичный лидерборд (2.4.a, ADR-0018). Кросс-юзерный агрегат по `match_players` ⋈ «честным» `matches`
 * (`registeredCount >= 2` — сетевые партии с ≥2 разными зарегистрированными) ⋈ не-удалённым `users` с
 * ником. Метрика сортировки — СУММА очков (решение заказчика). ОДИН агрегат вне горячего пути (запись
 * итога редка, чтение кэшируемо). Гостевые места (`user_id IS NULL`) отсекает inner join по `userId`.
 *
 * Приватность (ADR-0018): наружу только ник+аватар+числа — ни email/Google-id, ни имён гостей, ни кодов.
 * Удалённые аккаунты (tombstone `deleted_at`) в витрине не показываем, хотя их прошлое участие уже учтено
 * в `registered_count` чужих партий (честность рейтинга соперников сохраняется).
 */
import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { LeaderboardRow } from '../../../shared/protocol';

const DEFAULT_LIMIT = 20;
const MIN_REGISTERED = 2; // ≥2 разных зарегистрированных = «честная» партия (ADR-0018)

/** Сырая строка агрегата (ник теоретически null — фильтр SQL его отсекает; мапим защитно). */
interface RawRow {
  nickname: string | null;
  avatarUrl: string | null;
  points: number;
  best: number;
  played: number;
  wins: number;
}

/**
 * Чистый маппинг сырых строк агрегата в публичные строки лидерборда: защитно отсекаем строки без ника
 * (на случай рассинхрона) и проецируем поля. Без БД → тестируемо.
 */
export function toLeaderboardRows(raw: RawRow[]): LeaderboardRow[] {
  return raw
    .filter((r): r is RawRow & { nickname: string } => r.nickname != null)
    .map((r) => ({
      nickname: r.nickname,
      avatarUrl: r.avatarUrl,
      points: r.points,
      best: r.best,
      played: r.played,
      wins: r.wins,
    }));
}

/** Топ-N лидерборда по сумме очков. Нет БД (dev/гость) → пустой список, не падаем (как /tables в dev). */
export async function getLeaderboard(limit: number = DEFAULT_LIMIT): Promise<LeaderboardRow[]> {
  if (!process.env.DATABASE_URL) return []; // db/index.ts кидает без DATABASE_URL — гейтим до импорта
  const { db, schema } = await import('../db');
  const raw = await db
    .select({
      nickname: schema.users.nickname,
      avatarUrl: schema.users.avatarUrl,
      points: sql<number>`sum(${schema.matchPlayers.total})::int`,
      best: sql<number>`max(${schema.matchPlayers.total})::int`,
      played: sql<number>`count(*)::int`,
      wins: sql<number>`count(*) filter (where ${schema.matchPlayers.isWinner})::int`,
    })
    .from(schema.matchPlayers)
    .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPlayers.matchId))
    .innerJoin(schema.users, eq(schema.users.id, schema.matchPlayers.userId))
    .where(
      and(
        gte(schema.matches.registeredCount, MIN_REGISTERED),
        isNull(schema.users.deletedAt),
        isNotNull(schema.users.nickname),
      ),
    )
    .groupBy(schema.users.id) // users.id — PK; ник/аватар функционально зависимы (Postgres допускает)
    .orderBy(desc(sql`sum(${schema.matchPlayers.total})`))
    .limit(limit);
  return toLeaderboardRows(raw as RawRow[]);
}
