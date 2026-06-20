/**
 * Чистая модель рассадки по местам комнаты (2.1.e-2 → 2.2.a-1) — БЕЗ Socket.IO, поэтому тестируема
 * (см. seating.test.ts). Сетевая обвязка (создание сокета, join/disconnect, рассылка) — в
 * realtime.ts; авторитетная игровая логика партии — в rooms.ts. Тот же шов «чистое ↔ сокеты»,
 * что у rooms.ts/realtime.ts.
 */
import type { LobbyPayload } from '../../shared/protocol';
import type { RoomState } from './rooms';

/** До 4 игроков в комнате (2.2); партию запускает хозяин кнопкой Start при ≥ MIN_TO_START. */
export const ROOM_CAPACITY = 4;
export const MIN_TO_START = 2;

/** Одно место в комнате: к кому привязан живой сокет (null — место держим за ушедшим игроком). */
export interface Seat {
  socketId: string | null;
  playerId: string;
  name: string;
  /** Хозяин ли это место (создатель комнаты). Хозяин запускает партию (2.2). */
  isHost: boolean;
  /** Залогиненный аккаунт (2.3.c-3): userId платформы или null (гость). Для статистики/лидерборда (2.3.e). */
  userId?: string | null;
}

/** Комната платформы: код (=id) + места + (опционально) идущая партия. `game===null` до старта. */
export interface Room {
  /** Код комнаты (Crockford base32) — он же ключ реестра комнат. */
  id: string;
  seats: Seat[];
  game: RoomState | null;
  /** Метка создания (мс) — для TTL/сборки мусора заброшенных комнат (ADR-0009, защита памяти). */
  createdAt: number;
  /**
   * Когда ИДУЩАЯ партия осталась без живых сокетов (мс), иначе null. Даёт grace-период на реконнект
   * (ADR-0010): sweeper сносит брошенную партию только спустя паузу, а не мгновенно при общем блипе
   * сети у всех игроков. Сбрасывается в null, как только кто-то вернулся (reclaim).
   */
  emptiedAt: number | null;
}

/** Можно ли уже стартовать: партия ещё не идёт и набрался минимум игроков. */
export function canStart(room: Room): boolean {
  return room.game === null && room.seats.length >= MIN_TO_START;
}

/** Снимок состава лобби (до старта) для рассылки клиентам: список игроков, вместимость, готовность. */
export function lobbySnapshot(room: Room): LobbyPayload {
  return {
    roomId: room.id,
    players: room.seats.map((s, i) => ({ seat: i, name: s.name, isHost: s.isHost })),
    capacity: ROOM_CAPACITY,
    canStart: canStart(room),
  };
}

/**
 * Гарантировать наличие ЖИВОГО хозяина (минимальное наследование, 2.2.a-1; полное — 2.2.c). Если
 * живой хозяин уже есть — ничего. Иначе снимаем роль со всех и отдаём первому живому месту. Зовётся
 * после выхода игрока из лобби, чтобы было кому нажать Start. Возвращает нового хозяина (или undefined,
 * если живых мест не осталось).
 */
export function ensureHost(room: Room): Seat | undefined {
  const liveHost = room.seats.find((s) => s.isHost && s.socketId !== null);
  if (liveHost) return liveHost;
  for (const s of room.seats) s.isHost = false;
  const next = room.seats.find((s) => s.socketId !== null);
  if (next) next.isHost = true;
  return next;
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

/**
 * Развести одинаковые имена в комнате (2.2.b): если `name` уже занято кем-то из `existing` (сравнение
 * РЕГИСТРОНЕЗАВИСИМО — «Alice» и «alice» считаем одним), вернуть «name (2)», «name (3)»… до первого
 * свободного; иначе вернуть `name` как есть. Имена приходят уже нормализованными (`normalizeName` из
 * shared/names), так что сравниваем простым `toLocaleLowerCase`. Суффикс может вывести длину чуть за
 * `MAX_NAME_LEN` (два игрока с предельно длинными одинаковыми именами) — это лишь отображение в лобби,
 * не вопрос безопасности.
 */
export function dedupeName(existing: string[], name: string): string {
  const taken = new Set(existing.map((n) => n.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  // Кандидатов «(2)»… больше, чем занятых мест, => свободный гарантированно найдётся в этом диапазоне.
  for (let n = 2; n <= existing.length + 2; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return name; // недостижимо (принцип Дирихле) — страховка для типобезопасности
}
