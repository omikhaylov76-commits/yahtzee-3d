/**
 * Схема БД платформы (2.3.a). Таблицы аккаунтов под вход через Google (2.3.b) и кабинет (2.3.d).
 * Drizzle-схема — единственный источник структуры; SQL-миграции генерируются drizzle-kit из неё.
 * Статистику/историю партий добавим своими таблицами в 2.3.d/e (инкрементальной миграцией).
 */
import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/** Игрок-аккаунт. Создаётся при первом входе через провайдера (2.3.b). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  /** Версия токена сессии: инкремент отзывает ВСЕ выданные сессии (2.3.c). */
  tokenVersion: integer('token_version').notNull().default(0),
  /** Tombstone удаления аккаунта (2.3.d): не NULL → аккаунт удалён, профиль анонимизирован. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** Крючок монетизации (ADR no-pay-to-win): тариф. Пока всегда 'free'. */
  tier: text('tier').notNull().default('free'),
  /** Крючок монетизации: что игроку принадлежит (косметика/права). Пока пусто. */
  entitlements: jsonb('entitlements').$type<Record<string, unknown>>().notNull().default({}),
});

/** Способ входа игрока — привязка к внешнему провайдеру (2.3.b). Один user → много identities. */
export const identities = pgTable(
  'identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'google' (2.3.b)
    externalId: text('external_id').notNull(), // стабильный id у провайдера (напр. Google sub)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Один и тот же внешний аккаунт нельзя привязать дважды (re-auth для привязки, 2.3.b).
  (t) => [unique('identities_provider_external').on(t.provider, t.externalId)],
);
