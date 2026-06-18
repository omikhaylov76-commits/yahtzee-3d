/**
 * Каркас сервера платформы (2.0.a, ADR-0007/0014). Пока самодостаточен: только проверка «жив»
 * (`/health`). Ядро (`core`) НЕ импортирует — это 2.0.b (там же Socket.IO, версия протокола и
 * каркас границы платформа/игра). Изоляция: сперва убеждаемся, что серверная сборка/раннер
 * работают, отдельно от риска ESM-импорта ядра.
 */
import Fastify from 'fastify';
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

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

// Realtime поверх http-сервера fastify (2.0.c→2.1.b): рукопожатие + авторитетный игровой цикл.
// Композиционный корень инъецирует игровой модуль в платформу (платформа игро-НЕзависима, ADR-0011).
attachRealtime(app.server, app.log, CLIENT_ORIGIN, yahtzeeModule);

app.listen({ port: PORT, host: HOST }).then(
  () => {
    app.log.info({ game: yahtzeeModule.id, protocol: PROTOCOL_VERSION }, 'platform ready');
  },
  (err) => {
    app.log.error(err);
    process.exit(1);
  },
);
