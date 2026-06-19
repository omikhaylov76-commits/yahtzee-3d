import { defineConfig } from 'drizzle-kit';

/**
 * Конфиг drizzle-kit (2.3.a): генерация SQL-миграций из схемы и прогон на БД.
 * `DATABASE_URL` — из окружения (.env локально; drizzle-kit подхватывает .env сам).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/platform/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
