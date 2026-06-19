/**
 * Тесты чистой рассадки (2.1.e-2 → 2.2.a-1 → 2.2.b): reclaim места при реконнекте, состав лобби,
 * готовность к старту, наследование хозяина, дедуп одинаковых имён. Сокетов нет — гоняем чистые
 * функции на простых объектах комнаты.
 */
import { describe, it, expect } from 'vitest';
import {
  canStart,
  dedupeName,
  ensureHost,
  findReclaimSeat,
  lobbySnapshot,
  MIN_TO_START,
  ROOM_CAPACITY,
  type Room,
  type Seat,
} from './seating';

/** Краткая фабрика места (isHost по умолчанию false). */
function seat(playerId: string, over: Partial<Seat> = {}): Seat {
  return { socketId: `sock-${playerId}`, playerId, name: playerId, isHost: false, ...over };
}

function room(seats: Seat[], game: Room['game'] = null): Room {
  return { id: 'ABC234', seats, game, createdAt: 0, emptiedAt: null };
}

describe('findReclaimSeat', () => {
  it('находит удерживаемое место по playerId (socketId===null)', () => {
    const r = room([
      seat('seat-aaa', { socketId: 'sock-A', name: 'A' }),
      seat('seat-bbb', { socketId: null, name: 'B' }),
    ]);
    expect(findReclaimSeat(r, 'seat-bbb')?.playerId).toBe('seat-bbb');
  });

  it('находит место по playerId даже если оно ещё «живое» (гонка ping-timeout)', () => {
    const r = room([seat('seat-bbb', { socketId: 'old-sock', name: 'B' })]);
    expect(findReclaimSeat(r, 'seat-bbb')?.socketId).toBe('old-sock');
  });

  it('пустой playerId → undefined (обычный fresh-join)', () => {
    const r = room([seat('seat-bbb', { socketId: null })]);
    expect(findReclaimSeat(r, undefined)).toBeUndefined();
    expect(findReclaimSeat(r, '')).toBeUndefined();
  });

  it('неизвестный playerId → undefined', () => {
    const r = room([seat('seat-bbb', { socketId: null })]);
    expect(findReclaimSeat(r, 'seat-zzz')).toBeUndefined();
  });
});

describe('canStart', () => {
  it('false при < MIN_TO_START игроков', () => {
    expect(canStart(room([seat('a', { isHost: true })]))).toBe(false);
  });

  it('true при ≥ MIN_TO_START и непустой партии нет', () => {
    expect(canStart(room([seat('a', { isHost: true }), seat('b')]))).toBe(true);
    expect(MIN_TO_START).toBe(2);
  });

  it('false если партия уже идёт', () => {
    const started = room([seat('a', { isHost: true }), seat('b')], {} as Room['game']);
    expect(canStart(started)).toBe(false);
  });
});

describe('lobbySnapshot', () => {
  it('отражает состав, роль хозяина, вместимость и готовность', () => {
    const r = room([seat('a', { name: 'Alice', isHost: true }), seat('b', { name: 'Bob' })]);
    expect(lobbySnapshot(r)).toEqual({
      roomId: 'ABC234',
      players: [
        { seat: 0, name: 'Alice', isHost: true },
        { seat: 1, name: 'Bob', isHost: false },
      ],
      capacity: ROOM_CAPACITY,
      canStart: true,
    });
  });
});

describe('ensureHost', () => {
  it('ничего не меняет, если живой хозяин есть', () => {
    const r = room([seat('a', { isHost: true }), seat('b')]);
    expect(ensureHost(r)?.playerId).toBe('a');
    expect(r.seats[0].isHost).toBe(true);
    expect(r.seats[1].isHost).toBe(false);
  });

  it('передаёт роль первому живому, если хозяин ушёл (socketId===null)', () => {
    const r = room([
      seat('a', { socketId: null, isHost: true }),
      seat('b', { socketId: 'sock-b' }),
    ]);
    const next = ensureHost(r);
    expect(next?.playerId).toBe('b');
    expect(r.seats[0].isHost).toBe(false);
    expect(r.seats[1].isHost).toBe(true);
  });

  it('возвращает undefined, если живых мест не осталось', () => {
    const r = room([seat('a', { socketId: null, isHost: true })]);
    expect(ensureHost(r)).toBeUndefined();
  });
});

describe('dedupeName', () => {
  it('нет коллизии → имя как есть', () => {
    expect(dedupeName(['Alice'], 'Bob')).toBe('Bob');
    expect(dedupeName([], 'Alice')).toBe('Alice');
  });

  it('коллизия → суффикс (2), затем (3)', () => {
    expect(dedupeName(['Alice'], 'Alice')).toBe('Alice (2)');
    expect(dedupeName(['Alice', 'Alice (2)'], 'Alice')).toBe('Alice (3)');
  });

  it('сравнение регистронезависимо', () => {
    expect(dedupeName(['alice'], 'Alice')).toBe('Alice (2)');
  });

  it('дефолтные имена «Player N» уже уникальны по месту', () => {
    expect(dedupeName(['Player 1'], 'Player 2')).toBe('Player 2');
  });
});
