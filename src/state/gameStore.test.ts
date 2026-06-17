import { describe, it, expect } from 'vitest';
import { createGameStore } from './gameStore';
import { LocalTransport } from '../transport/LocalTransport';
import { MemoryGameStorage } from '../storage/memoryGameStorage';

const players = [{ name: 'A' }, { name: 'B' }];

function freshStore() {
  const storage = new MemoryGameStorage();
  const transport = new LocalTransport(storage, () => 1);
  return { store: createGameStore(transport), storage };
}

describe('gameStore (мост)', () => {
  it('стартует с пустым состоянием', () => {
    const { store } = freshStore();
    expect(store.getState().state).toBeNull();
    expect(store.getState().events).toEqual([]);
  });

  it('newGame наполняет состояние через транспорт', () => {
    const { store } = freshStore();
    store.getState().newGame(players);
    expect(store.getState().state?.players).toHaveLength(2);
    expect(store.getState().state?.phase).toBe('playing');
  });

  it('roll/score меняют состояние и кладут события', () => {
    const { store } = freshStore();
    store.getState().newGame(players);
    store.getState().roll();
    expect(store.getState().state?.rollsLeft).toBe(2);
    expect(store.getState().events).toContainEqual({ type: 'dice:rolled' });
    store.getState().score('chance');
    expect(store.getState().state?.current).toBe(1);
    expect(store.getState().events.some((e) => e.type === 'score:written')).toBe(true);
  });

  it('toggleHold фиксирует кость', () => {
    const { store } = freshStore();
    store.getState().newGame(players);
    store.getState().roll();
    store.getState().toggleHold(0);
    expect(store.getState().state?.dice[0].held).toBe(true);
  });

  it('восстанавливает партию из хранилища (новый стор на том же storage)', () => {
    const storage = new MemoryGameStorage();
    const t1 = new LocalTransport(storage, () => 9);
    const s1 = createGameStore(t1);
    s1.getState().newGame(players);
    s1.getState().roll();

    const t2 = new LocalTransport(storage);
    const s2 = createGameStore(t2);
    expect(s2.getState().state).toEqual(s1.getState().state);
  });
});
