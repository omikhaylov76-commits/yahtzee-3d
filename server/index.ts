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
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'; // CORS dev-origin

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

// Realtime поверх http-сервера fastify (2.0.c): рукопожатие + версия протокола.
attachRealtime(app.server, app.log, CLIENT_ORIGIN);

app.listen({ port: PORT, host: HOST }).then(
  () => {
    // Доказательство, что общий код исполняется на сервере: дескриптор игры берётся из core,
    // версия — из shared/. (Реальный realtime/комнаты — 2.0.c/2.1.)
    app.log.info(
      { game: yahtzeeModule.id, categories: yahtzeeModule.categories, protocol: PROTOCOL_VERSION },
      'platform ready',
    );
  },
  (err) => {
    app.log.error(err);
    process.exit(1);
  },
);
