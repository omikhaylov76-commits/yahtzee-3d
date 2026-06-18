/**
 * Клиентский сетевой слой платформы (2.0.c). Подключается к серверу по Socket.IO, передаёт
 * версию протокола в рукопожатии (ADR-0013). Пока — только проба соединения; игровой обмен
 * (действия/состояние через NetworkTransport) — 2.1.
 */
import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION } from '../../shared/protocol';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export type ConnStatus = 'connecting' | 'connected' | 'mismatch' | 'offline';

/** Подключиться к платформе; статусы соединения идут в onStatus. Вернёт socket (для disconnect). */
export function connectPlatform(onStatus: (status: ConnStatus) => void): Socket {
  const socket = io(SERVER_URL, { auth: { protocolVersion: PROTOCOL_VERSION } });
  let mismatched = false;

  onStatus('connecting');
  socket.on('connect', () => {
    if (!mismatched) onStatus('connected');
  });
  socket.on('protocol:mismatch', () => {
    // Версия не совпала: переподключаться бессмысленно — нужен refresh страницы.
    mismatched = true;
    onStatus('mismatch');
    socket.close();
  });
  socket.on('connect_error', () => {
    if (!mismatched) onStatus('offline');
  });
  socket.on('disconnect', () => {
    if (!mismatched) onStatus('connecting'); // socket.io сам переподключается
  });

  return socket;
}
