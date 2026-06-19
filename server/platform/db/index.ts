/**
 * Клиент БД платформы (2.3.a): pg-пул + drizzle. URL из env (`DATABASE_URL`): на Railway — внутренний
 * приватный адрес (reference `${{Postgres.DATABASE_URL}}`), локально — публичный (`DATABASE_PUBLIC_URL`
 * Railway, см. `.env`). Секрет живёт ТОЛЬКО в env. Импортируется лишь там, где реально нужна БД
 * (вход/кабинет — 2.3.b+), чтобы сервер без БД-нужды не падал на старте.
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (см. .env локально / переменные Railway)');
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
export { schema };
