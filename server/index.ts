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
import { PROTOCOL_VERSION } from '../shared/protocol';
import { yahtzeeModule } from './games/yahtzee';
import { attachRealtime } from './platform/realtime';

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

app.get('/health', async () => ({ status: 'ok' }));

// Realtime поверх http-сервера fastify (2.0.c→2.1.b): рукопожатие + авторитетный игровой цикл.
const { getStatus } = attachRealtime(app.server, app.log, CLIENT_ORIGIN, yahtzeeModule);

// Лёгкий мониторинг (2.P.2): только агрегаты — без кодов комнат и имён (код = пропуск в игру).
app.get('/status', async () => getStatus());

// Вход через Google (2.3.b) — ОПЦИОНАЛЕН: без GOOGLE_* сервер поднимается как раньше (прод-пилот/dev
// без входа). Динамический импорт держит БД-слой ленивым — грузится лишь когда вход реально включён.
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI) {
  const { createGoogleAuthProvider } = await import('./platform/auth/google');
  const { registerAuth } = await import('./platform/auth/routes');
  registerAuth(
    app,
    createGoogleAuthProvider({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: GOOGLE_REDIRECT_URI,
    }),
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
