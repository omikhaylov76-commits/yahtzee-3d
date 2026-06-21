/**
 * Откат синтетического сидера лидерборда (tier='seed'): удаляет места этих игроков, осиротевшие партии
 * (где были ТОЛЬКО синтетические) и самих игроков. Реальные партии (с реальными игроками) НЕ трогает.
 *
 * Запуск: node --env-file=.env --import tsx server/scripts/unseed-leaderboard.ts
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../platform/db';

async function main(): Promise<void> {
  const seed = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.tier, 'seed'));
  const ids = seed.map((s) => s.id);
  if (!ids.length) {
    console.log('no seed users — nothing to do');
    return;
  }
  await db.delete(schema.matchPlayers).where(inArray(schema.matchPlayers.userId, ids));
  // Осиротевшие партии (не осталось ни одного match_players) — это были чисто синтетические.
  await db
    .delete(schema.matches)
    .where(sql`${schema.matches.id} NOT IN (SELECT match_id FROM match_players)`);
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
  console.log(`unseeded ${ids.length} seed users + their matches`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
