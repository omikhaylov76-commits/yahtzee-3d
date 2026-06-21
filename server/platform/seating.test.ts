/**
 * Тесты чистой рассадки (2.1.e-2 → 2.2.a-1 → 2.2.b): reclaim места при реконнекте, состав лобби,
 * готовность к старту, наследование хозяина, дедуп одинаковых имён. Сокетов нет — гоняем чистые
 * функции на простых объектах комнаты.
 */
import { describe, it, expect } from 'vitest';
import {
  allReadyToStart,
  canStart,
  createHouseTables,
  dedupeName,
  ensureHost,
  findReclaimSeat,
  HOUSE_TABLES,
  lobbySnapshot,
  MIN_TO_START,
  publicTables,
  readyTimeoutAction,
  resetRoomToLobby,
  ROOM_CAPACITY,
  seatName,
  type Room,
  type Seat,
} from './seating';

/** Краткая фабрика места (isHost по умолчанию false). */
function seat(playerId: string, over: Partial<Seat> = {}): Seat {
  return {
    socketId: `sock-${playerId}`,
    playerId,
    name: playerId,
    isHost: false,
    ready: false,
    notReadySince: null,
    ...over,
  };
}

function room(seats: Seat[], game: Room['game'] = null): Room {
  return { id: 'ABC234', visibility: 'private', seats, game, createdAt: 0, emptiedAt: null };
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
        { seat: 0, name: 'Alice', isHost: true, ready: false },
        { seat: 1, name: 'Bob', isHost: false, ready: false },
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

describe('seatName', () => {
  it('залогиненный — под своим ником (ник важнее присланного имени)', () => {
    expect(seatName({ nickname: 'Neo' }, 'spoofed', 0)).toBe('Neo');
  });

  it('гость — под присланным именем', () => {
    expect(seatName(null, 'Trinity', 1)).toBe('Trinity');
  });

  it('пусто/невидимки → дефолт «Player N» по месту', () => {
    expect(seatName(null, '   ', 2)).toBe('Player 3');
    expect(seatName({ nickname: null }, undefined, 0)).toBe('Player 1');
  });

  it('имя чистится общим normalizeName (XSS/невидимки)', () => {
    expect(seatName(null, '<b>Hi', 0)).toBe('bHi');
  });
});

describe('resetRoomToLobby', () => {
  it('обнуляет партию и сбрасывает готовность оставшихся', () => {
    const r = room(
      [seat('a', { isHost: true, ready: true }), seat('b', { ready: true })],
      {} as Room['game'],
    );
    resetRoomToLobby(r);
    expect(r.game).toBeNull();
    expect(r.seats.every((s) => s.ready === false)).toBe(true);
  });

  it('убирает места ушедших по ходу (socketId===null), оставляет живых', () => {
    const r = room(
      [seat('a', { socketId: 'live', isHost: true }), seat('b', { socketId: null })],
      {} as Room['game'],
    );
    resetRoomToLobby(r);
    expect(r.seats.map((s) => s.playerId)).toEqual(['a']);
  });

  it('передаёт хозяина живому, если прежний хозяин ушёл по ходу (его место снято)', () => {
    const r = room(
      [seat('a', { socketId: null, isHost: true }), seat('b', { socketId: 'live' })],
      {} as Room['game'],
    );
    resetRoomToLobby(r);
    expect(r.seats).toHaveLength(1);
    expect(r.seats[0].playerId).toBe('b');
    expect(r.seats[0].isHost).toBe(true);
  });

  it('сбрасывает emptiedAt (маркер брошенной партии, не лобби)', () => {
    const r = room([seat('a', { isHost: true })], {} as Room['game']);
    r.emptiedAt = 123;
    resetRoomToLobby(r);
    expect(r.emptiedAt).toBeNull();
  });
});

describe('allReadyToStart', () => {
  it('true: все готовы и их ≥ MIN_TO_START, партия не идёт', () => {
    const r = room([seat('a', { ready: true }), seat('b', { ready: true })]);
    expect(allReadyToStart(r)).toBe(true);
  });

  it('false: хотя бы один не готов', () => {
    const r = room([seat('a', { ready: true }), seat('b', { ready: false })]);
    expect(allReadyToStart(r)).toBe(false);
  });

  it('false: готов только один (< MIN_TO_START)', () => {
    const r = room([seat('a', { ready: true })]);
    expect(allReadyToStart(r)).toBe(false);
  });

  it('false: партия уже идёт', () => {
    const r = room([seat('a', { ready: true }), seat('b', { ready: true })], {} as Room['game']);
    expect(allReadyToStart(r)).toBe(false);
  });
});

describe('createHouseTables', () => {
  it('создаёт 5 дежурных: persistent, пустые, с морскими названиями и id house-N', () => {
    const tables = createHouseTables();
    expect(tables).toHaveLength(5);
    expect(tables.every((t) => t.visibility === 'persistent')).toBe(true);
    expect(tables.every((t) => t.game === null && t.seats.length === 0)).toBe(true);
    expect(tables.map((t) => t.id)).toEqual([
      'house-1',
      'house-2',
      'house-3',
      'house-4',
      'house-5',
    ]);
    expect(tables.map((t) => t.title)).toEqual(HOUSE_TABLES.map((h) => h.title));
  });

  it('каждый вызов даёт СВЕЖИЕ объекты (без общих ссылок на seats)', () => {
    const a = createHouseTables();
    const b = createHouseTables();
    expect(a[0]).not.toBe(b[0]);
    expect(a[0].seats).not.toBe(b[0].seats);
  });

  it('id дежурных НЕ являются валидными кодами комнат (вход только публичный, joinOpen)', () => {
    // Страховка инварианта ADR-0017: дежурные не пересекаются с пространством секретных кодов.
    expect(HOUSE_TABLES.every((t) => t.id.includes('house-'))).toBe(true);
  });
});

describe('publicTables', () => {
  it('включает open/persistent, исключает private; агрегаты без имён/кодов', () => {
    const priv = room([seat('a')]); // private по умолчанию
    const open = room([seat('b'), seat('c')]);
    open.id = 'K7Q9ZP';
    open.visibility = 'open';
    open.title = 'Friday game';
    const house = createHouseTables()[0];
    const list = publicTables([priv, open, house]);
    expect(list.map((t) => t.tableId)).toEqual(['K7Q9ZP', 'house-1']); // приватный исключён
    expect(list[0]).toEqual({
      tableId: 'K7Q9ZP',
      title: 'Friday game',
      count: 2,
      capacity: ROOM_CAPACITY,
      status: 'waiting',
    });
    expect(list[1].title).toBe('Tide Table');
  });

  it('status: in-game при идущей партии, full при заполнении', () => {
    const full = room([seat('a'), seat('b'), seat('c'), seat('d')]);
    full.visibility = 'open';
    expect(publicTables([full])[0].status).toBe('full');
    const playing = room([seat('a'), seat('b')], {} as Room['game']);
    playing.visibility = 'open';
    expect(publicTables([playing])[0].status).toBe('in-game');
  });

  it('открытый стол без названия → дефолт «Open table»', () => {
    const open = room([seat('a')]);
    open.visibility = 'open';
    expect(publicTables([open])[0].title).toBe('Open table');
  });

  it('приватные не попадают в список (нет утечки кода)', () => {
    expect(publicTables([room([seat('a')])])).toEqual([]);
  });
});

describe('readyTimeoutAction', () => {
  it('готовое место — не трогаем (null)', () => {
    expect(readyTimeoutAction(seat('a', { ready: true }), 1000, 60_000)).toBeNull();
  });

  it('не-готовое без метки → stamp (засечь время)', () => {
    expect(readyTimeoutAction(seat('a', { ready: false, notReadySince: null }), 1000, 60_000)).toBe(
      'stamp',
    );
  });

  it('не-готовое в пределах таймаута → null (ещё ждём)', () => {
    const s = seat('a', { ready: false, notReadySince: 1000 });
    expect(readyTimeoutAction(s, 1000 + 30_000, 60_000)).toBeNull();
  });

  it('не-готовое дольше таймаута → free (освободить место)', () => {
    const s = seat('a', { ready: false, notReadySince: 1000 });
    expect(readyTimeoutAction(s, 1000 + 60_001, 60_000)).toBe('free');
  });
});
