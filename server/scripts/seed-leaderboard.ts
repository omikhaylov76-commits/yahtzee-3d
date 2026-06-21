/**
 * РАЗОВЫЙ синтетический сидер лидерборда (по запросу заказчика, 2026-06-21): лёгкая «затравка», чтобы
 * лидерборд не был пустым и появился азарт занять 1-е место; реальные результаты со временем её вытеснят
 * (объём намеренно МАЛЫЙ, очки умеренные). Маркер `tier='seed'` → чистый откат (unseed-leaderboard.ts).
 * Идемпотентно: если seed-игроки уже есть — выходит, не задваивает.
 *
 * Запуск (грузит DATABASE_URL из .env — это прод-БД Railway!):
 *   node --env-file=.env --import tsx server/scripts/seed-leaderboard.ts
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../platform/db';
import { nicknameKey } from '../../shared/nickname';

const NICKS = [
  'DiceWizard',
  'LuckyAnna',
  'MikeRoller',
  'Yahtzilla',
  'QueenOfFives',
  'BoxcarBob',
  'TripleSix',
  'NovaDice',
  'RollinRita',
  'SirCupcake',
];
const DAYS = 5;
const TIER = 'seed';
const DAY_MS = 86_400_000;

const ri = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a + 1));
function pickN<T>(arr: readonly T[], n: number): T[] {
  const c = [...arr];
  const out: T[] = [];
  while (out.length < n && c.length) out.push(c.splice(ri(0, c.length - 1), 1)[0]);
  return out;
}
// Умеренный Yahtzee-тотал (изредка «удачная» партия) — чтобы реальным игрокам было реально обогнать.
const total = (): number => Math.min(360, ri(150, 290) + (Math.random() < 0.12 ? ri(20, 70) : 0));

async function main(): Promise<void> {
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.tier, TIER));
  if (existing.length) {
    console.log(
      `seed users already present (${existing.length}) — abort. Откат: unseed-leaderboard.ts`,
    );
    return;
  }

  const users = await db
    .insert(schema.users)
    .values(
      NICKS.map((n) => ({
        displayName: n,
        nickname: n,
        nicknameKey: nicknameKey(n),
        avatarUrl: null,
        tier: TIER,
      })),
    )
    .returning({ id: schema.users.id, nickname: schema.users.nickname });
  console.log(`users: ${users.length}`);

  // DAYS дней × 1-3 партии (2-4 игрока), затем гарантируем, что КАЖДЫЙ из 10 сыграл ≥1 (азарт у всех).
  type Game = { day: number; players: { id: string; nickname: string | null }[] };
  const plan: Game[] = [];
  for (let d = DAYS - 1; d >= 0; d--) {
    for (let g = 0, k = ri(1, 3); g < k; g++)
      plan.push({ day: d, players: pickN(users, ri(2, 4)) });
  }
  const covered = new Set(plan.flatMap((g) => g.players.map((p) => p.id)));
  const missing = users.filter((u) => !covered.has(u.id));
  for (let i = 0; i < missing.length; i += 3) {
    const grp = [...missing.slice(i, i + 3), ...pickN(users, 1)].slice(0, 4);
    plan.push({ day: ri(0, DAYS - 1), players: grp });
  }

  let rows = 0;
  for (const g of plan) {
    const totals = g.players.map(() => total());
    const max = Math.max(...totals);
    const finishedAt = new Date(Date.now() - g.day * DAY_MS - ri(0, 80_000_000));
    const [m] = await db
      .insert(schema.matches)
      .values({
        gameId: 'yahtzee',
        finishedAt,
        playerCount: g.players.length,
        registeredCount: g.players.length,
      })
      .returning({ id: schema.matches.id });
    await db.insert(schema.matchPlayers).values(
      g.players.map((p, i) => ({
        matchId: m.id,
        userId: p.id,
        displayName: p.nickname ?? 'Player',
        total: totals[i],
        isWinner: totals[i] === max,
      })),
    );
    rows += g.players.length;
  }
  console.log(`matches: ${plan.length}, player-rows: ${rows}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
