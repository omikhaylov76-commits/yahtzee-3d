/**
 * Аккаунты платформы (2.3.b/c): найти по внешней привязке или создать; получить по id для сессии.
 * Привязка уникальна по (provider, externalId). Новый игрок: user + первая привязка в одной транзакции.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db';
import type { AuthUserInfo } from './AuthProvider';

export interface PlatformUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  tokenVersion: number;
}

const userCols = {
  id: schema.users.id,
  displayName: schema.users.displayName,
  avatarUrl: schema.users.avatarUrl,
  tokenVersion: schema.users.tokenVersion,
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

/** Получить активного (не удалённого) пользователя по id — для проверки сессии (`/auth/me`). */
export async function getUserById(id: string): Promise<PlatformUser | null> {
  const [user] = await db
    .select(userCols)
    .from(schema.users)
    .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
    .limit(1);
  return user ?? null;
}
