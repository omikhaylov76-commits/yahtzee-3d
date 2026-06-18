/**
 * Realtime-слой платформы (2.0.c, ADR-0013). Пока: рукопожатие с проверкой версии протокола
 * + счётчик активных соединений в логах. Комнаты и игровой обмен (действия/состояние) — 2.1+.
 */
import type { Server as HttpServer } from 'node:http';
import type { FastifyBaseLogger } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { PROTOCOL_VERSION } from '../../shared/protocol';

export function attachRealtime(
  httpServer: HttpServer,
  log: FastifyBaseLogger,
  clientOrigin: string,
): Server {
  const io = new Server(httpServer, { cors: { origin: clientOrigin } });
  let connections = 0;

  io.on('connection', (socket: Socket) => {
    // Версия протокола в рукопожатии — граница безопасности (ADR-0013): несовпадение клиента и
    // сервера => не обрабатываем, просим обновить страницу.
    const version = socket.handshake.auth?.protocolVersion;
    if (version !== PROTOCOL_VERSION) {
      log.warn({ got: version, expected: PROTOCOL_VERSION }, 'protocol mismatch — disconnecting');
      socket.emit('protocol:mismatch', { server: PROTOCOL_VERSION });
      socket.disconnect(true);
      return;
    }

    connections++;
    log.info({ connections }, 'socket connected');
    socket.emit('hello', { protocol: PROTOCOL_VERSION });

    socket.on('disconnect', () => {
      connections--;
      log.info({ connections }, 'socket disconnected');
    });
  });

  return io;
}
