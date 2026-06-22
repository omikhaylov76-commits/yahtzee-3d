/**
 * Откат синтетического сидера лидерборда (tier='seed'): удаляет ТОЛЬКО партии, где ВСЕ участники —
 * синтетические, и самих синтетических игроков (тех, на кого больше не ссылается история). Партии, где
 * синтетик играл с реальным игроком ИЛИ гостем, НЕ трогаются — иначе откат сидера снёс бы реальную
 * историю/очки (партия удаляется целиком, FK match_players→matches каскадный). Защита от потери данных.
 *
 * Запуск (грузит DATABASE_URL из .env — это прод-БД Railway!):
 *   node --env-file=.env --import tsx server/scripts/unseed-leaderboard.ts            # удаление
 *   node --env-file=.env --import tsx server/scripts/unseed-leaderboard.ts --dry-run  # только показать
 */
import { eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import { db, schema } from '../platform/db';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const seed = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.tier, 'seed'));
  const seedIds = seed.map((s) => s.id);
  if (!seedIds.length) {
    console.log('no seed users — nothing to do');
    return;
  }

  // Партии с ≥1 синтетическим участником.
  const withSeed = await db
    .selectDistinct({ matchId: schema.matchPlayers.matchId })
    .from(schema.matchPlayers)
    .where(inArray(schema.matchPlayers.userId, seedIds));
  // Партии, где ЕСТЬ не-синтетик: гость (user_id IS NULL) ИЛИ реальный игрок (user_id вне seedIds).
  const impure = await db
    .selectDistinct({ matchId: schema.matchPlayers.matchId })
    .from(schema.matchPlayers)
    .where(or(isNull(schema.matchPlayers.userId), notInArray(schema.matchPlayers.userId, seedIds)));
  const impureIds = new Set(impure.map((r) => r.matchId));
  // Чисто-синтетические: был синтетик и НЕ было никого постороннего.
  const pureSeedMatchIds = withSeed.map((r) => r.matchId).filter((id) => !impureIds.has(id));
  const mixedCount = withSeed.length - pureSeedMatchIds.length;

  if (DRY_RUN) {
    console.log(`[dry-run] seed users: ${seedIds.length}`);
    console.log(`[dry-run] matches with a seed player: ${withSeed.length}`);
    console.log(
      `[dry-run] pure-seed matches (WOULD delete, cascades match_players): ${pureSeedMatchIds.length}`,
    );
    console.log(`[dry-run] mixed matches (WOULD keep — real player/guest present): ${mixedCount}`);
    console.log('[dry-run] no rows deleted');
    return;
  }

  // Удаляем чисто-синтетические партии; их match_players снимаются каскадом (FK onDelete: 'cascade').
  if (pureSeedMatchIds.length) {
    await db.delete(schema.matches).where(inArray(schema.matches.id, pureSeedMatchIds));
  }
  // Удаляем синтетических игроков, на которых больше НЕ ссылается ни одна строка match_players
  // (оставшиеся — те, кто играл в смешанной партии: их сносить нельзя, иначе осиротеет реальная история).
  const stillRef = await db
    .selectDistinct({ userId: schema.matchPlayers.userId })
    .from(schema.matchPlayers)
    .where(inArray(schema.matchPlayers.userId, seedIds));
  const referenced = new Set(stillRef.map((r) => r.userId));
  const deletableUserIds = seedIds.filter((id) => !referenced.has(id));
  if (deletableUserIds.length) {
    await db.delete(schema.users).where(inArray(schema.users.id, deletableUserIds));
  }
  console.log(
    `unseeded: ${pureSeedMatchIds.length} pure-seed matches, ${deletableUserIds.length} seed users` +
      (mixedCount
        ? ` (kept ${mixedCount} mixed matches, ${seedIds.length - deletableUserIds.length} seed users still referenced)`
        : ''),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
