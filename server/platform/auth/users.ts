/**
 * Аккаунты платформы (2.3.b/c): найти по внешней привязке или создать; получить по id для сессии.
 * Привязка уникальна по (provider, externalId). Новый игрок: user + первая привязка в одной транзакции.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db';
import type { AuthUserInfo } from './AuthProvider';
import { normalizeName } from '../../../shared/names';
import { isReservedNickname, isValidNickname, nicknameKey } from '../../../shared/nickname';

export interface PlatformUser {
  id: string;
  displayName: string;
  /** Игровой ник (ADR-0015): null = ещё не выбран (онбординг) или освобождён при удалении. */
  nickname: string | null;
  avatarUrl: string | null;
  tokenVersion: number;
}

const userCols = {
  id: schema.users.id,
  displayName: schema.users.displayName,
  nickname: schema.users.nickname,
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

/** Результат смены ника (2.3.e-2a). */
export type SetNicknameResult =
  | { ok: true; nickname: string }
  | { ok: false; reason: 'invalid' | 'reserved' | 'taken' };

/**
 * Postgres unique-violation (нарушение UNIQUE-индекса) — SQLSTATE 23505. drizzle оборачивает ошибку pg
 * в `DrizzleQueryError`, поэтому код лежит в `.cause` (а не прямо в `.code`) — проверяем оба места.
 */
function isUniqueViolation(e: unknown): boolean {
  const code =
    (e as { code?: string } | null)?.code ??
    (e as { cause?: { code?: string } } | null)?.cause?.code;
  return code === '23505';
}

/**
 * Установить игровой ник пользователя (2.3.e-2a, ADR-0015). Авторитетная серверная проверка:
 * нормализация → валидность → резерв → запись с уникальностью (ключ без учёта регистра). Уникальность
 * гарантирует частичный UNIQUE-индекс `users_nickname_key_uq`; гонку (двое берут один ник) ловим как
 * `23505` → `taken` (истина в БД, не предпроверка — без TOCTOU).
 */
export async function setNickname(userId: string, raw: string): Promise<SetNicknameResult> {
  if (!isValidNickname(raw)) return { ok: false, reason: 'invalid' };
  const nickname = normalizeName(raw);
  const key = nicknameKey(raw);
  if (isReservedNickname(key)) return { ok: false, reason: 'reserved' };
  try {
    await db
      .update(schema.users)
      .set({ nickname, nicknameKey: key })
      .where(eq(schema.users.id, userId));
    return { ok: true, nickname };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: 'taken' };
    throw e;
  }
}
