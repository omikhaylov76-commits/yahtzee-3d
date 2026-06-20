/**
 * Аккаунты платформы (2.3.b): найти игрока по внешней привязке или создать нового. Привязка уникальна
 * по (provider, externalId) — повторный вход того же Google-аккаунта возвращает существующего user.
 * Новый игрок: user + первая привязка создаются в ОДНОЙ транзакции (без «осиротевших» строк).
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import type { AuthUserInfo } from './AuthProvider';

export interface PlatformUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

const userCols = {
  id: schema.users.id,
  displayName: schema.users.displayName,
  avatarUrl: schema.users.avatarUrl,
};

export async function findOrCreateUser(info: AuthUserInfo): Promise<PlatformUser> {
  const [identity] = await db
    .select({ userId: schema.identities.userId })
    .from(schema.identities)
    .where(
      and(
        eq(schema.identities.provider, info.provider),
        eq(schema.identities.externalId, info.externalId),
      ),
    )
    .limit(1);

  if (identity) {
    const [user] = await db
      .select(userCols)
      .from(schema.users)
      .where(eq(schema.users.id, identity.userId))
      .limit(1);
    if (!user) throw new Error('identity without user (data integrity)');
    return user;
  }

  // Новый игрок: user + первая привязка в одной транзакции.
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ displayName: info.displayName, avatarUrl: info.avatarUrl })
      .returning(userCols);
    await tx
      .insert(schema.identities)
      .values({ userId: user.id, provider: info.provider, externalId: info.externalId });
    return user;
  });
}
