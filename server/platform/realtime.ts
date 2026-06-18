/**
 * Realtime-слой платформы (2.0.c→2.1.b, ADR-0013). Рукопожатие с проверкой версии протокола +
 * авторитетный игровой цикл: посадка в комнату, авто-старт, приём действий, рассылка публичного
 * состояния с версией. Чистая логика партии — в rooms.ts; здесь только Socket.IO-обвязка и реестр
 * комнат в памяти.
 *
 * 2.1 — МИНИМАЛЬНАЯ комната: вход в общую комнату по `roomId`, авто-старт при 2 игроках. Коды из
 * CSPRNG, лобби, хозяин/кик, 3–4 игрока — 2.2 (поверх этой же модели). Reconnect-токены — 2.4;
 * здесь при разрыве место просто освобождается.
 */
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { FastifyBaseLogger } from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  MSG,
  PROTOCOL_VERSION,
  type ActionMessage,
  type DeniedPayload,
  type JoinRequest,
  type JoinedPayload,
  type StatePayload,
} from '../../shared/protocol';
import { applyNetworkAction, startGame, type RoomState, type YahtzeeModule } from './rooms';
import { randomSeed, rollDiceValues } from './rng';

const ROOM_CAPACITY = 2; // 2.1: партия двух вкладок. 3–4 игрока и коды — 2.2.
const MIN_TO_START = 2;
const DICE_COUNT = 5;

interface Seat {
  socketId: string | null;
  playerId: string;
  name: string;
}

interface Room {
  id: string;
  seats: Seat[];
  game: RoomState | null; // null до старта
}

/** Лёгкая очистка имени гостя (анти-XSS/контрол-символы). Полная валидация (NFC/bidi/zod) — 2.2.b. */
function cleanName(raw: string | undefined, seat: number): string {
  const s = [...(raw ?? '')]
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c > 0x1f && c !== 0x7f && ch !== '<' && ch !== '>';
    })
    .join('')
    .trim()
    .slice(0, 20);
  return s || `Player ${seat + 1}`;
}

export function attachRealtime(
  httpServer: HttpServer,
  log: FastifyBaseLogger,
  clientOrigin: string | string[],
  module: YahtzeeModule,
): Server {
  const io = new Server(httpServer, { cors: { origin: clientOrigin } });
  const rooms = new Map<string, Room>();
  const sockets = new Map<string, { roomId: string; playerId: string }>(); // socket.id -> место
  let connections = 0;

  /** Снимок состояния комнаты в протокольный payload. */
  function snapshot(room: Room, events: StatePayload['events']): StatePayload {
    const game = room.game!;
    return { stateVersion: game.stateVersion, state: module.toPublicState(game.state), events };
  }

  io.on('connection', (socket: Socket) => {
    // Версия протокола в рукопожатии — граница безопасности (ADR-0013).
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

    socket.on(MSG.join, (req: JoinRequest) => {
      const roomId = (req?.roomId ?? '').trim() || 'dev';
      let room = rooms.get(roomId);
      if (!room) {
        room = { id: roomId, seats: [], game: null };
        rooms.set(roomId, room);
      }
      // Партия уже идёт или мест нет — в 2.1 это «комната занята» (продуктовые состояния — 2.2.d).
      if (room.game || room.seats.length >= ROOM_CAPACITY) {
        socket.emit(MSG.full, { roomId });
        return;
      }

      const seat = room.seats.length;
      const playerId = `seat-${randomUUID().slice(0, 8)}`;
      room.seats.push({ socketId: socket.id, playerId, name: cleanName(req?.name, seat) });
      sockets.set(socket.id, { roomId, playerId });
      socket.join(roomId);
      const joined: JoinedPayload = { roomId, playerId, seat };
      socket.emit(MSG.joined, joined);
      log.info({ roomId, playerId, seat }, 'player joined');

      // Авто-старт при сборе игроков (хозяин/ручной старт — 2.2.c).
      if (room.seats.length >= MIN_TO_START) {
        room.game = startGame(
          module,
          room.seats.map((s) => ({ id: s.playerId, name: s.name })),
          randomSeed(),
        );
        log.info({ roomId, players: room.seats.length }, 'game started');
        io.to(roomId).emit(MSG.state, snapshot(room, []));
      }
    });

    socket.on(MSG.action, (msg: ActionMessage) => {
      const ctx = sockets.get(socket.id);
      if (!ctx) return; // действие без посадки — игнор
      const room = rooms.get(ctx.roomId);
      if (!room?.game) {
        socket.emit(MSG.denied, {
          reason: 'no-game',
          actionId: msg?.actionId,
        } satisfies DeniedPayload);
        return;
      }

      const result = applyNetworkAction(module, room.game, ctx.playerId, msg, () =>
        rollDiceValues(DICE_COUNT),
      );
      room.game = result.room;

      if (result.duplicate) {
        // Повтор (дубль Socket.IO): состояние не менялось, шлём автору текущий снимок.
        socket.emit(MSG.state, snapshot(room, []));
        return;
      }
      if (result.denied) {
        socket.emit(MSG.denied, {
          reason: result.denied,
          actionId: msg.actionId,
        } satisfies DeniedPayload);
        return;
      }
      // Успех: рассылаем новое авторитетное состояние + события всем в комнате.
      io.to(room.id).emit(MSG.state, snapshot(room, result.events));
    });

    socket.on('disconnect', () => {
      connections--;
      log.info({ connections }, 'socket disconnected');
      const ctx = sockets.get(socket.id);
      if (!ctx) return;
      sockets.delete(socket.id);
      const room = rooms.get(ctx.roomId);
      if (!room) return;
      if (room.game === null) {
        // Партия ещё НЕ началась: освобождаем место ПОЛНОСТЬЮ, иначе «мёртвое» место (socketId=null)
        // считается занятым и новый игрок в ту же комнату упрётся в room:full.
        room.seats = room.seats.filter((s) => s.playerId !== ctx.playerId);
      } else {
        // Партия идёт: место держим за игроком (пауза/реконнект-арбитраж — 2.1.e/2.4).
        const seat = room.seats.find((s) => s.playerId === ctx.playerId);
        if (seat) seat.socketId = null;
      }
      log.info({ roomId: room.id, playerId: ctx.playerId }, 'player left');
      // Никого живого не осталось — убираем комнату (TTL/«остался один» — 2.2.d). Пустой seats тоже.
      if (room.seats.every((s) => s.socketId === null)) rooms.delete(room.id);
    });
  });

  return io;
}
