/**
 * Каркас сервера платформы (2.0.a, ADR-0007/0014). Пока самодостаточен: только проверка «жив»
 * (`/health`). Ядро (`core`) НЕ импортирует — это 2.0.b (там же Socket.IO, версия протокола и
 * каркас границы платформа/игра). Изоляция: сперва убеждаемся, что серверная сборка/раннер
 * работают, отдельно от риска ESM-импорта ядра.
 */
import Fastify from 'fastify';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0'; // Railway требует 0.0.0.0

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
