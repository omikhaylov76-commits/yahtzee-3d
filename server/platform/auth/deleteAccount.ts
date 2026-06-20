/**
 * Удаление аккаунта (2.3.e-6, ADR-0015) — НЕОБРАТИМО, ОДНА транзакция (tombstone): затираем PII в профиле
 * И в снимках истории, освобождаем ник, отвязываем входы, отзываем сессии. `user_id` в истории СОХРАНЯЕМ
 * (честность рейтинга 2.4); `users` НЕ удаляем физически (FK `match_players.user_id` = NO ACTION). Повторный
 * вход Google → НОВЫЙ аккаунт (identities удалены, не «зомби»). Активные сокеты/места чистит отдельно
 * `realtime.forgetUser` (фикс гонки C1/M3 — поздняя запись итога не должна воскресить PID). Ленивый db-импорт.
 */
import { eq, sql } from 'drizzle-orm';
import { DELETED_PLAYER_NAME } from '../../../shared/nickname';

export async function deleteAccount(userId: string): Promise<void> {
  const { db, schema } = await import('../db');
  await db.transaction(async (tx) => {
    // Профиль: обезличить + освободить ник + tombstone + отозвать ВСЕ сессии (token_version++).
    await tx
      .update(schema.users)
      .set({
        displayName: DELETED_PLAYER_NAME,
        nickname: null,
        nicknameKey: null,
        avatarUrl: null,
        deletedAt: new Date(),
        tokenVersion: sql`${schema.users.tokenVersion} + 1`,
      })
      .where(eq(schema.users.id, userId));
    // Снимки имени в истории → «Deleted player» (user_id СОХРАНЯЕМ — честность рейтинга 2.4).
    await tx
      .update(schema.matchPlayers)
      .set({ displayName: DELETED_PLAYER_NAME })
      .where(eq(schema.matchPlayers.userId, userId));
    // Отвязать входы → повторный вход = новый аккаунт.
    await tx.delete(schema.identities).where(eq(schema.identities.userId, userId));
  });
}
