/**
 * Композиционный корень сервера платформы (2.0→2.1→2.2→2.P). Поднимает fastify, цепляет realtime
 * (рукопожатие + авторитетный игровой цикл) и — в проде — РАЗДАЁТ собранный клиент с того же origin
 * (2.P.1), чтобы другу хватало одной ссылки. Платформа игро-НЕзависима: игровой модуль инъецируется
 * здесь (ADR-0011).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { yahtzeeModule } from './games/yahtzee';
import { attachRealtime } from './platform/realtime';
import { getLeaderboard } from './platform/stats/leaderboard';
import type { SessionUser } from './platform/auth/sessionResolver';
import type { MatchRows } from './platform/stats/buildRows';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0'; // Railway требует 0.0.0.0
// CORS-origin(ы) клиента: список через запятую (dev + прод-клиент). На Railway — через env.
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Собранный клиент (vite build → dist/). `../dist` от ЭТОГО модуля указывает на корень/dist и в dev
// (tsx: server/index.ts), и в prod-бандле (tsup: dist-server/index.js): в ESM нет __dirname (аудит C3).
const clientDist = fileURLToPath(new URL('../dist', import.meta.url));

const app = Fastify({ logger: true });
app.register(fastifyCookie); // cookie сессии входа (2.3.c)

app.get('/health', async () => ({ status: 'ok' }));

// Вход через Google (2.3.b/c) — ОПЦИОНАЛЕН: без GOOGLE_* сервер поднимается как прод-пилот/dev.
// Резолвер сессии нужен realtime (2.3.c-3 — имя из аккаунта), поэтому определяем ДО attachRealtime.
// Динамический импорт держит БД-слой ленивым — грузится лишь когда вход включён.
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
const authEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
let sessionResolver:
  | ((cookieHeader: string | undefined) => Promise<SessionUser | null>)
  | undefined;
// Запись итога партии (2.3.d-2) — тоже за БД: грузим лениво вместе с сессиями (та же предпосылка DATABASE_URL).
let recordMatch: ((rows: MatchRows) => Promise<string>) | undefined;
if (authEnabled) {
  ({ resolveSessionUser: sessionResolver } = await import('./platform/auth/sessionResolver'));
  ({ recordMatch } = await import('./platform/stats/record'));
}

// Realtime поверх http-сервера fastify (2.0.c→2.1.b): рукопожатие + авторитетный игровой цикл.
const { getStatus, getTables, isPlayerActive, forgetUser } = attachRealtime(
  app.server,
  app.log,
  CLIENT_ORIGIN,
  yahtzeeModule,
  sessionResolver,
  recordMatch,
);

// Лёгкий мониторинг (2.P.2): только агрегаты — без кодов комнат и имён (код = пропуск в игру).
app.get('/status', async () => getStatus());

// Публичный список открытых/дежурных столов (ADR-0017, 2.5.d): только агрегаты, без имён игроков и
// без секретных кодов приватных комнат. Вход в стол из списка — по сокету (joinOpen).
app.get('/tables', async () => getTables());

// Публичный лидерборд (ADR-0018, 2.4.a): топ по сумме очков честных сетевых партий; только ник+аватар+
// числа. Без БД (dev/гость) → пустой список (getLeaderboard гейтит по DATABASE_URL).
app.get('/leaderboard', async () => getLeaderboard());

if (authEnabled) {
  const { createGoogleAuthProvider } = await import('./platform/auth/google');
  const { registerAuth } = await import('./platform/auth/routes');
  registerAuth(
    app,
    createGoogleAuthProvider({
      clientId: GOOGLE_CLIENT_ID!,
      clientSecret: GOOGLE_CLIENT_SECRET!,
      redirectUri: GOOGLE_REDIRECT_URI!,
    }),
    { isPlayerActive, forgetUser },
  );
  app.log.info('google auth enabled');
} else {
  app.log.info('google auth disabled (no GOOGLE_* env)');
}

// Раздача собранного клиента same-origin (2.P.1): один адрес отдаёт и игру, и realtime — другу одна
// ссылка. Регистрируем ТОЛЬКО если клиент собран: в dev его обычно нет (Vite на :5173), а
// @fastify/static бросает на несуществующем root (аудит M5). `/socket.io/*` перехватывает engine.io ДО
// fastify; `/health` (и `/status` в 2.P.2) — обычные маршруты; прочий GET → index.html (SPA + ?room=).
if (existsSync(clientDist)) {
  app.register(fastifyStatic, { root: clientDist, index: ['index.html'] });
  app.setNotFoundHandler((req, reply) =>
    req.method === 'GET'
      ? reply.sendFile('index.html')
      : reply.code(404).send({ error: 'not-found' }),
  );
  app.log.info({ clientDist }, 'serving client (same-origin)');
} else {
  app.log.info({ clientDist }, 'client build not found — API/realtime only (dev)');
}

app.listen({ port: PORT, host: HOST }).then(
  () => {
    app.log.info({ game: yahtzeeModule.id, protocol: PROTOCOL_VERSION }, 'platform ready');
  },
  (err) => {
    app.log.error(err);
    process.exit(1);
  },
);
