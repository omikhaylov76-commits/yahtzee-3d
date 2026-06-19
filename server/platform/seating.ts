/**
 * Чистая модель рассадки по местам комнаты (2.1.e-2) — БЕЗ Socket.IO, поэтому тестируема
 * (см. seating.test.ts). Сетевая обвязка (создание сокета, join/disconnect, рассылка) — в
 * realtime.ts; авторитетная игровая логика партии — в rooms.ts. Тот же шов «чистое ↔ сокеты»,
 * что у rooms.ts/realtime.ts.
 */
import type { RoomState } from './rooms';

/** Одно место в комнате: к кому привязан живой сокет (null — место держим за ушедшим игроком). */
export interface Seat {
  socketId: string | null;
  playerId: string;
  name: string;
}

/** Комната платформы: места + (опционально) идущая партия. `game===null` до старта. */
export interface Room {
  id: string;
  seats: Seat[];
  game: RoomState | null;
}

/**
 * Найти место для RECLAIM при реконнекте (2.1.e-2): место с таким `playerId` (выдан сервером при
 * первом входе). Матчим по id НЕЗАВИСИМО от текущего `socketId`: engine.io может узнать о смерти
 * старого сокета с задержкой (ping-timeout) уже ПОСЛЕ возврата клиента новым сокетом — ждать
 * `socketId===null` нельзя, иначе reclaim упёрся бы в `room:full`. Пустой/неизвестный id → undefined
 * (обычный fresh-join). Перепривязку `socketId` и анти-затирание делает вызывающий (realtime.ts).
 */
export function findReclaimSeat(room: Room, playerId: string | undefined): Seat | undefined {
  if (!playerId) return undefined;
  return room.seats.find((s) => s.playerId === playerId);
}
