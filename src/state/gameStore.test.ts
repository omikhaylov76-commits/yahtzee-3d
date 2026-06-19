import { describe, it, expect, vi } from 'vitest';
import { createGameStore } from './gameStore';
import { LocalTransport } from '../transport/LocalTransport';
import { MemoryGameStorage } from '../storage/memoryGameStorage';
import type { Transport, TransportListener } from '../transport/Transport';
import type { Action, DomainEvent, GameState } from '../core';
import type { OnlineSession } from '../platform/net';

const players = [{ name: 'A' }, { name: 'B' }];

function freshStore() {
  const storage = new MemoryGameStorage();
  const transport = new LocalTransport(storage, () => 1);
  return { store: createGameStore(transport), storage };
}

/** Фейковый сетевой транспорт для теста свапа: пишет действия и умеет «прислать состояние». */
class FakeNetTransport implements Transport {
  readonly dispatched: Action[] = [];
  resetCalls = 0;
  private state: GameState | null = null;
  private readonly listeners = new Set<TransportListener>();
  getState() {
    return this.state;
  }
  dispatch(action: Action) {
    this.dispatched.push(action);
  }
  reset() {
    this.resetCalls += 1;
  }
  subscribe(listener: TransportListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Имитировать приход состояния от сервера. */
  push(state: GameState | null, events: DomainEvent[] = []) {
    this.state = state;
    for (const l of this.listeners) l(state, events);
  }
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

describe('gameStore — свап транспорта online↔local (2.1.d-1)', () => {
  function onlineStore() {
    const storage = new MemoryGameStorage();
    const local = new LocalTransport(storage, () => 1);
    const net = new FakeNetTransport();
    const dispose = vi.fn();
    let statusCb: ((s: import('../platform/net').OnlineStatus) => void) | null = null;
    const make = (onStatus: (s: import('../platform/net').OnlineStatus) => void): OnlineSession => {
      statusCb = onStatus;
      return { transport: net, dispose };
    };
    const store = createGameStore(local, make);
    return { store, net, dispose, status: () => statusCb };
  }

  it('goOnline переключает режим и зеркалит сетевое состояние, а не локальное', () => {
    const { store, net } = onlineStore();
    store.getState().goOnline();
    expect(store.getState().mode).toBe('online');
    expect(store.getState().onlineStatus).toBe('connecting');
    expect(store.getState().state).toBeNull(); // сетевая партия ещё не пришла

    // Действия идут в сетевой транспорт, не в локальный.
    store.getState().roll();
    expect(net.dispatched).toEqual([{ type: 'ROLL' }]);

    // Приход состояния от сервера зеркалится в стор.
    const serverState = { phase: 'playing' } as unknown as GameState;
    net.push(serverState, [{ type: 'dice:rolled' }]);
    expect(store.getState().state).toBe(serverState);
    expect(store.getState().events).toEqual([{ type: 'dice:rolled' }]);
  });

  it('статус сессии из фабрики попадает в стор', () => {
    const { store, status } = onlineStore();
    store.getState().goOnline();
    status()?.('waiting');
    expect(store.getState().onlineStatus).toBe('waiting');
    status()?.('playing');
    expect(store.getState().onlineStatus).toBe('playing');
  });

  it('goLocal отключает сетевой транспорт и возвращает сохранённую локальную партию', () => {
    const { store, net, dispose } = onlineStore();
    // Локальная партия существует ДО онлайна и не должна потеряться.
    store.getState().newGame(players);
    const localState = store.getState().state;
    expect(localState?.phase).toBe('playing');

    store.getState().goOnline();
    net.push({ phase: 'playing' } as unknown as GameState); // в онлайне своё состояние
    expect(store.getState().state).not.toBe(localState);

    store.getState().goLocal();
    expect(dispose).toHaveBeenCalledTimes(1); // сокет/сетевой транспорт закрыт
    expect(store.getState().mode).toBe('local');
    expect(store.getState().onlineStatus).toBeNull();
    expect(store.getState().state).toEqual(localState); // локальная партия цела

    // После возврата действия снова идут в локальный транспорт (сетевой не трогается).
    const before = net.dispatched.length;
    store.getState().roll();
    expect(net.dispatched.length).toBe(before);
    expect(store.getState().state?.rollsLeft).toBe(2);
  });

  it('reset() в онлайне выходит в локальный режим, не залипая (фикс C1)', () => {
    const { store, net, dispose } = onlineStore();
    store.getState().goOnline();
    net.push({ phase: 'over' } as unknown as GameState); // онлайн-партия закончилась
    expect(store.getState().mode).toBe('online');

    // «Main menu» из WinnerScreen зовёт reset() — в онлайне он должен разорвать сессию.
    store.getState().reset();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(store.getState().mode).toBe('local');
    expect(store.getState().onlineStatus).toBeNull();
    expect(store.getState().state).toBeNull(); // локальной партии не было — пусто, как и ждёт меню

    // mode не залип: повторный заход в онлайн снова создаёт сессию.
    store.getState().goOnline();
    expect(store.getState().mode).toBe('online');
  });

  it('повторный goOnline/goLocal идемпотентен (нет двойной сессии)', () => {
    const { store, dispose } = onlineStore();
    store.getState().goOnline();
    store.getState().goOnline(); // уже online — no-op
    store.getState().goLocal();
    store.getState().goLocal(); // уже local — no-op
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
