/**
 * Тесты чистой рассадки (2.1.e-2): решение reclaim места при реконнекте. Сокетов нет — гоняем
 * `findReclaimSeat` на простых объектах комнаты.
 */
import { describe, it, expect } from 'vitest';
import { findReclaimSeat, type Room } from './seating';

function room(seats: Room['seats']): Room {
  return { id: 'dev', seats, game: null };
}

describe('findReclaimSeat', () => {
  it('находит удерживаемое место по playerId (socketId===null)', () => {
    const r = room([
      { socketId: 'sock-A', playerId: 'seat-aaa', name: 'A' },
      { socketId: null, playerId: 'seat-bbb', name: 'B' },
    ]);
    expect(findReclaimSeat(r, 'seat-bbb')?.playerId).toBe('seat-bbb');
  });

  it('находит место по playerId даже если оно ещё «живое» (гонка ping-timeout)', () => {
    // Старый сокет ещё не объявлен мёртвым, а клиент уже вернулся новым — reclaim не должен ждать null.
    const r = room([{ socketId: 'old-sock', playerId: 'seat-bbb', name: 'B' }]);
    expect(findReclaimSeat(r, 'seat-bbb')?.socketId).toBe('old-sock');
  });

  it('пустой playerId → undefined (обычный fresh-join)', () => {
    const r = room([{ socketId: null, playerId: 'seat-bbb', name: 'B' }]);
    expect(findReclaimSeat(r, undefined)).toBeUndefined();
    expect(findReclaimSeat(r, '')).toBeUndefined();
  });

  it('неизвестный playerId → undefined', () => {
    const r = room([{ socketId: null, playerId: 'seat-bbb', name: 'B' }]);
    expect(findReclaimSeat(r, 'seat-zzz')).toBeUndefined();
  });
});
