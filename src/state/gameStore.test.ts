import { describe, it, expect, vi } from 'vitest';
import { createGameStore, selectInputLocked, selectTurnBanner } from './gameStore';
import { LocalTransport } from '../transport/LocalTransport';
import { MemoryGameStorage } from '../storage/memoryGameStorage';
import type { Transport, TransportListener } from '../transport/Transport';
import type { Action, DomainEvent, GameState } from '../core';
import type { OnlineCallbacks, OnlineSession } from '../platform/net';
import type { OnlineIntent } from '../transport/NetworkTransport';

const players = [{ name: 'A' }, { name: 'B' }];

function freshStore() {
  const storage = new MemoryGameStorage();
  const transport = new LocalTransport(storage, () => 1);
  return { store: createGameStore(transport), storage };
}

/** Фейковый сетевой транспорт для теста свапа: пишет действия и умеет «прислать состояние».
 *  Имитирует и «сетевые» геттеры `NetworkTransport` (playerId места + pending), которые стор
 *  зеркалит для гейтинга ввода (2.1.d-3). */
class FakeNetTransport implements Transport {
  readonly dispatched: Action[] = [];
  resetCalls = 0;
  /** id места этого клиента (как сервер выдаёт в `joined`). */
  playerId: string | null = null;
  private pending = false;
  private state: GameState | null = null;
  private readonly listeners = new Set<TransportListener>();
  getState() {
    return this.state;
  }
  dispatch(action: Action) {
    this.dispatched.push(action);
    this.pending = true; // как в NetworkTransport: действие «в полёте» до ответа сервера
  }
  reset() {
    this.resetCalls += 1;
  }
  subscribe(listener: TransportListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Имитировать приход состояния от сервера (снимает pending, как авторитетный ответ). */
  push(state: GameState | null, events: DomainEvent[] = []) {
    this.state = state;
    this.pending = false;
    for (const l of this.listeners) l(state, events);
  }
  getPlayerId() {
    return this.playerId;
  }
  getPending() {
    return this.pending;
  }
}

/** Минимальное «играбельное» сетевое состояние: двое игроков с id, чей ход — `currentId`. */
function netState(currentId: 'A' | 'B'): GameState {
  return {
    players: [
      { id: 'A', name: 'A' },
      { id: 'B', name: 'B' },
    ],
    current: currentId === 'A' ? 0 : 1,
    phase: 'playing',
  } as unknown as GameState;
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
    const start = vi.fn();
    let cb: OnlineCallbacks | null = null;
    const make = (_intent: OnlineIntent, callbacks: OnlineCallbacks): OnlineSession => {
      cb = callbacks;
      return { transport: net, dispose, start };
    };
    const store = createGameStore(local, make);
    return { store, net, dispose, start, status: () => cb?.onStatus ?? null, cb: () => cb };
  }

  it('goOnline переключает режим и зеркалит сетевое состояние, а не локальное', () => {
    const { store, net } = onlineStore();
    store.getState().goOnline({ type: 'create' });
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
    store.getState().goOnline({ type: 'create' });
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

    store.getState().goOnline({ type: 'create' });
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
    store.getState().goOnline({ type: 'create' });
    net.push({ phase: 'over' } as unknown as GameState); // онлайн-партия закончилась
    expect(store.getState().mode).toBe('online');

    // «Main menu» из WinnerScreen зовёт reset() — в онлайне он должен разорвать сессию.
    store.getState().reset();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(store.getState().mode).toBe('local');
    expect(store.getState().onlineStatus).toBeNull();
    expect(store.getState().state).toBeNull(); // локальной партии не было — пусто, как и ждёт меню

    // mode не залип: повторный заход в онлайн снова создаёт сессию.
    store.getState().goOnline({ type: 'create' });
    expect(store.getState().mode).toBe('online');
  });

  it('повторный goOnline/goLocal идемпотентен (нет двойной сессии)', () => {
    const { store, dispose } = onlineStore();
    store.getState().goOnline({ type: 'create' });
    store.getState().goOnline({ type: 'create' }); // уже online — no-op
    store.getState().goLocal();
    store.getState().goLocal(); // уже local — no-op
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('лобби/посадка зеркалятся в стор; startGameOnline зовёт session.start; goLocal чистит', () => {
    const { store, start, cb } = onlineStore();
    store.getState().goOnline({ type: 'create' });
    cb()?.onJoined({ roomId: 'K7Q9ZP', playerId: 'seat-1', seat: 0, isHost: true });
    cb()?.onLobby({
      roomId: 'K7Q9ZP',
      players: [{ seat: 0, name: 'Alice', isHost: true }],
      capacity: 4,
      canStart: false,
    });
    expect(store.getState().roomCode).toBe('K7Q9ZP');
    expect(store.getState().isHost).toBe(true);
    expect(store.getState().mySeat).toBe(0);
    expect(store.getState().lobby?.players).toHaveLength(1);

    store.getState().startGameOnline();
    expect(start).toHaveBeenCalledTimes(1);

    store.getState().goLocal();
    expect(store.getState().lobby).toBeNull();
    expect(store.getState().isHost).toBe(false);
    expect(store.getState().roomCode).toBeNull();
    expect(store.getState().mySeat).toBeNull();
  });
});

describe('gameStore — сетевой гейтинг ввода (2.1.d-3)', () => {
  function onlineStore() {
    const storage = new MemoryGameStorage();
    const local = new LocalTransport(storage, () => 1);
    const net = new FakeNetTransport();
    let cb: OnlineCallbacks | null = null;
    const make = (_intent: OnlineIntent, callbacks: OnlineCallbacks): OnlineSession => {
      cb = callbacks;
      return { transport: net, dispose: vi.fn(), start: vi.fn() };
    };
    const store = createGameStore(local, make);
    return { store, net, status: () => cb?.onStatus ?? null, cb: () => cb };
  }

  /** Войти в онлайн как игрок `me`, получить «играбельное» состояние с ходом `currentId`. */
  function enterOnline(me: 'A' | 'B', currentId: 'A' | 'B') {
    const ctx = onlineStore();
    ctx.store.getState().goOnline({ type: 'create' });
    ctx.net.playerId = me;
    ctx.status()?.('playing');
    ctx.net.push(netState(currentId));
    return ctx;
  }

  it('myPlayerId зеркалится из сетевого транспорта', () => {
    const { store } = enterOnline('A', 'A');
    expect(store.getState().myPlayerId).toBe('A');
  });

  it('pending встаёт после действия и снимается на приходе состояния', () => {
    const { store, net } = enterOnline('A', 'A');
    expect(store.getState().pending).toBe(false);
    store.getState().roll();
    expect(store.getState().pending).toBe(true); // действие в полёте — блокируем ввод
    net.push(netState('B')); // сервер ответил, ход перешёл
    expect(store.getState().pending).toBe(false);
  });

  it('selectInputLocked: разблокирован в свой ход, заблокирован в чужой', () => {
    const mine = enterOnline('A', 'A');
    expect(selectInputLocked(mine.store.getState())).toBe(false);
    expect(selectTurnBanner(mine.store.getState())).toBeNull();

    const theirs = enterOnline('A', 'B');
    expect(selectInputLocked(theirs.store.getState())).toBe(true);
    expect(selectTurnBanner(theirs.store.getState())).toBe("Opponent's turn");
  });

  it('selectInputLocked: заблокирован, пока действие в полёте (pending)', () => {
    const { store } = enterOnline('A', 'A');
    store.getState().roll();
    expect(selectInputLocked(store.getState())).toBe(true);
    expect(selectTurnBanner(store.getState())).toBeNull(); // pending баннера не показывает
  });

  it('myPlayerId ещё неизвестен (null) при playing: заблокирован, но баннер не врёт «чужой ход»', () => {
    const ctx = onlineStore();
    ctx.store.getState().goOnline({ type: 'create' });
    ctx.status()?.('playing');
    ctx.net.push(netState('A')); // состояние пришло, но joined ещё не выдал нам playerId
    expect(ctx.store.getState().myPlayerId).toBeNull();
    expect(selectInputLocked(ctx.store.getState())).toBe(true); // fail-safe
    expect(selectTurnBanner(ctx.store.getState())).toBeNull(); // не утверждаем «Opponent's turn»
  });

  it('selectInputLocked: заблокирован при потере соединения (статус не playing)', () => {
    const { store, status } = enterOnline('A', 'A');
    status()?.('connecting'); // разрыв: socket.io переподключается
    expect(selectInputLocked(store.getState())).toBe(true);
    expect(selectTurnBanner(store.getState())).toBe('Connection lost — reconnecting…');
  });

  it('local-режим: ввод никогда не заблокирован, баннера нет (без регрессий Вехи 1)', () => {
    const { store } = freshStore();
    store.getState().newGame(players);
    expect(selectInputLocked(store.getState())).toBe(false);
    expect(selectTurnBanner(store.getState())).toBeNull();
    store.getState().roll();
    expect(selectInputLocked(store.getState())).toBe(false);
  });
});
