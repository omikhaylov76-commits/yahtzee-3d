import { describe, it, expect, vi } from 'vitest';
import type { DomainEvent, GameState } from '../core';
import { MemoryGameStorage } from '../storage/memoryGameStorage';
import { LocalTransport } from './LocalTransport';

const players = [{ name: 'A' }, { name: 'B' }];

describe('LocalTransport', () => {
  it('NEW_GAME создаёт партию и уведомляет подписчиков', () => {
    const t = new LocalTransport(new MemoryGameStorage());
    const seen: Array<GameState | null> = [];
    t.subscribe((s) => seen.push(s));
    t.dispatch({ type: 'NEW_GAME', players, seed: 1 });

    expect(t.getState()).not.toBeNull();
    expect(t.getState()?.players).toHaveLength(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.phase).toBe('playing');
  });

  it('ROLL/SCORE прогоняются через ядро, события доходят до подписчиков', () => {
    const t = new LocalTransport(new MemoryGameStorage());
    const events: DomainEvent[] = [];
    t.subscribe((_s, ev) => events.push(...ev));
    t.dispatch({ type: 'NEW_GAME', players, seed: 1 });
    t.dispatch({ type: 'ROLL' });
    expect(t.getState()?.rollsLeft).toBe(2);
    expect(events).toContainEqual({ type: 'dice:rolled' });
    t.dispatch({ type: 'SCORE', category: 'chance' });
    expect(events.some((e) => e.type === 'score:written')).toBe(true);
    expect(t.getState()?.current).toBe(1);
  });

  it('действие до NEW_GAME игнорируется (state остаётся null)', () => {
    const t = new LocalTransport(new MemoryGameStorage());
    const fn = vi.fn();
    t.subscribe(fn);
    t.dispatch({ type: 'ROLL' });
    expect(t.getState()).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('сохраняет партию: новый транспорт на том же хранилище её восстанавливает', () => {
    const storage = new MemoryGameStorage();
    const t1 = new LocalTransport(storage);
    t1.dispatch({ type: 'NEW_GAME', players, seed: 7 });
    t1.dispatch({ type: 'ROLL' });
    const snapshot = t1.getState();

    const t2 = new LocalTransport(storage);
    expect(t2.getState()).toEqual(snapshot);
  });

  it('отписка прекращает уведомления', () => {
    const t = new LocalTransport(new MemoryGameStorage());
    const fn = vi.fn();
    const off = t.subscribe(fn);
    t.dispatch({ type: 'NEW_GAME', players, seed: 1 });
    off();
    t.dispatch({ type: 'ROLL' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reset очищает партию и сохранение, уведомляет null', () => {
    const storage = new MemoryGameStorage();
    const t = new LocalTransport(storage);
    const seen: Array<GameState | null> = [];
    t.dispatch({ type: 'NEW_GAME', players, seed: 1 });
    t.subscribe((s) => seen.push(s));
    t.reset();
    expect(t.getState()).toBeNull();
    expect(storage.load()).toBeNull();
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('подставляет случайный seed, если он не задан (через инъекцию makeSeed)', () => {
    const makeSeed = vi.fn(() => 123);
    const t = new LocalTransport(new MemoryGameStorage(), makeSeed);
    t.dispatch({ type: 'NEW_GAME', players });
    expect(makeSeed).toHaveBeenCalledTimes(1);
    expect(t.getState()?.seed).toBe(123);
  });
});

// NetworkTransport реализован в 2.1.c — его поведение покрыто в NetworkTransport.test.ts.
