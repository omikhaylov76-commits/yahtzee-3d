/**
 * Схема БД платформы. Аккаунты/привязки — вход через Google (2.3.a/b/c); история партий
 * (`matches` / `match_players`) — запись итогов сетевых партий (2.3.d), фундамент статистики кабинета
 * (2.3.e) и лидерборда (2.4). Drizzle-схема — единственный источник структуры; SQL-миграции генерирует
 * drizzle-kit из неё.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** Игрок-аккаунт. Создаётся при первом входе через провайдера (2.3.b). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  /** Версия токена сессии: инкремент отзывает ВСЕ выданные сессии (2.3.c). */
  tokenVersion: integer('token_version').notNull().default(0),
  /** Tombstone удаления аккаунта (2.3.e): не NULL → аккаунт удалён, профиль анонимизирован. */
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

/**
 * Завершённая СЕТЕВАЯ партия (2.3.d). Пишется ТОЛЬКО при естественном конце (`game:over`) и если был
 * ≥1 зарегистрированный участник. Брошенные/прерванные/локальные — не пишутся (политика зачёта, 2.4.a).
 */
export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Игра-модуль (`module.id`), напр. 'yahtzee' — задел под портал (ADR-0011). */
  gameId: text('game_id').notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
  /** Всего мест в партии (включая гостей). */
  playerCount: integer('player_count').notNull(),
  /**
   * Из них с аккаунтом. Несущее поле фильтра «честной» партии для лидерборда (2.4.a): `>= 2` одним
   * индексируемым условием. Из `player_count` (вкл. гостей) это невыразимо; пересчёт задним числом — больно.
   */
  registeredCount: integer('registered_count').notNull(),
});

/**
 * Участник партии — строка на КАЖДОЕ место (2.3.d). `user_id` NULL = СТРОГО гость (аккаунта не было).
 * Аккаунт удаляется tombstone'ом (`users.deleted_at`), НЕ физически, поэтому ON DELETE по умолчанию
 * (NO ACTION): снести user с историей физически = ошибка БД (инвариант целостности истории). В чужой
 * истории удалённого показываем «Deleted player» живым джойном по `users.deleted_at` (2.3.e), `user_id`
 * сохраняется. `display_name` — СНИМОК имени на момент партии (история переживает смену/удаление ника).
 */
export const matchPlayers = pgTable(
  'match_players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    displayName: text('display_name').notNull(),
    total: integer('total').notNull(),
    isWinner: boolean('is_winner').notNull().default(false),
  },
  // Запрос статистики игрока (2.3.e) и агрегаты лидерборда (2.4.a) идут по user_id.
  (t) => [index('match_players_user_idx').on(t.userId)],
);
