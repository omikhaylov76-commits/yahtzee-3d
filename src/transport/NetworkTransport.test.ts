/**
 * Тесты сетевого транспорта (2.1.c): версия-гейт, in-flight `pending`, `denied`-обработка, маппинг
 * действий, `reset`. Сервер не нужен — подставляем фейковый сокет и гоняем входящие события вручную.
 */
import { describe, it, expect } from 'vitest';
import { NetworkTransport, type TransportSocket } from './NetworkTransport';
import { MSG, type StatePayload } from '../../shared/protocol';
import { createGame, toPublicState, type DomainEvent, type GameState } from '../core';

/** Фейковый сокет: запоминает подписки и исходящие emit; умеет «прислать» событие от сервера. */
class FakeSocket implements TransportSocket {
  handlers: Record<string, (p: unknown) => void> = {};
  sent: { event: string; payload: unknown }[] = [];
  disconnected = false;
  on(event: string, listener: (p: unknown) => void): void {
    this.handlers[event] = listener;
  }
  emit(event: string, payload?: unknown): void {
    this.sent.push({ event, payload });
  }
  disconnect(): void {
    this.disconnected = true;
  }
  /** Эмуляция сообщения сервер -> клиент. */
  server(event: string, payload: unknown): void {
    this.handlers[event]?.(payload);
  }
}

// Публичное состояние без seed/rng; для тестов достаточно валидного снимка партии.
function snapshot(
  version: number,
  events: DomainEvent[] = [{ type: 'dice:rolled' }],
): StatePayload {
  const g = createGame(
    [
      { name: 'A', id: 'A' },
      { name: 'B', id: 'B' },
    ],
    1,
  );
  return { stateVersion: version, state: toPublicState(g), events };
}

/** id действий по порядку — чтобы матчить denied и проверять отправку. */
function seqIds() {
  let n = 0;
  return () => `aid-${++n}`;
}

describe('NetworkTransport — вход и состояние', () => {
  it('на конструкции входит в комнату (room:join)', () => {
    const s = new FakeSocket();
    new NetworkTransport(s, 'dev', seqIds());
    expect(s.sent[0]).toEqual({ event: MSG.join, payload: { roomId: 'dev' } });
  });

  it('применяет более новую версию и уведомляет подписчиков', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());
    const got: { state: GameState | null; events: DomainEvent[] }[] = [];
    t.subscribe((state, events) => got.push({ state, events }));

    s.server(MSG.state, snapshot(1));

    expect(t.getState()).not.toBeNull();
    expect(got).toHaveLength(1);
    expect(got[0].events).toEqual([{ type: 'dice:rolled' }]);
  });

  it('игнорирует устаревшую/равную версию', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());
    const got: DomainEvent[][] = [];
    t.subscribe((_state, events) => got.push(events));

    s.server(MSG.state, snapshot(2));
    s.server(MSG.state, snapshot(2)); // равная — игнор
    s.server(MSG.state, snapshot(1)); // меньшая — игнор

    expect(got).toHaveLength(1);
  });
});

describe('NetworkTransport — pending-гейт и маппинг', () => {
  it('ROLL уходит без values; второй dispatch гейтится до прихода состояния', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());

    t.dispatch({ type: 'ROLL' });
    t.dispatch({ type: 'ROLL' }); // pending — игнор

    const actions = s.sent.filter((m) => m.event === MSG.action);
    expect(actions).toHaveLength(1);
    expect(actions[0].payload).toEqual({ action: { type: 'ROLL' }, actionId: 'aid-1' });

    // Пришло новое состояние -> pending снят -> следующий ROLL уходит.
    s.server(MSG.state, snapshot(1));
    t.dispatch({ type: 'ROLL' });
    expect(s.sent.filter((m) => m.event === MSG.action)).toHaveLength(2);
  });

  it('TOGGLE_HOLD и SCORE мапятся в сетевое действие', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());

    t.dispatch({ type: 'TOGGLE_HOLD', index: 2 });
    s.server(MSG.state, snapshot(1));
    t.dispatch({ type: 'SCORE', category: 'chance' });

    const actions = s.sent.filter((m) => m.event === MSG.action).map((m) => m.payload);
    expect(actions[0]).toEqual({ action: { type: 'TOGGLE_HOLD', index: 2 }, actionId: 'aid-1' });
    expect(actions[1]).toEqual({
      action: { type: 'SCORE', category: 'chance' },
      actionId: 'aid-2',
    });
  });

  it('dispatch(NEW_GAME) игнорируется (партию создаёт сервер)', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());
    t.dispatch({ type: 'NEW_GAME', players: [{ name: 'A' }] });
    expect(s.sent.filter((m) => m.event === MSG.action)).toHaveLength(0);
  });
});

describe('NetworkTransport — denied и reset', () => {
  it('denied на наш actionId снимает pending и эмитит action:denied', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());
    const got: DomainEvent[][] = [];
    t.subscribe((_state, events) => got.push(events));

    t.dispatch({ type: 'ROLL' }); // actionId aid-1, pending
    s.server(MSG.denied, { reason: 'not-your-turn', actionId: 'aid-1' });

    expect(got).toEqual([[{ type: 'action:denied', reason: 'not-your-turn' }]]);
    // pending снят -> следующий dispatch уходит
    t.dispatch({ type: 'ROLL' });
    expect(s.sent.filter((m) => m.event === MSG.action)).toHaveLength(2);
  });

  it('denied без in-flight действия не эмитит (анти-двойной отказ)', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());
    const got: DomainEvent[][] = [];
    t.subscribe((_state, events) => got.push(events));

    s.server(MSG.denied, { reason: 'no-game' }); // нет нашего pending
    expect(got).toHaveLength(0);
  });

  it('после reset поздний state с сокета игнорируется (не воскрешает партию)', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());
    s.server(MSG.state, snapshot(1));
    const got: (GameState | null)[] = [];
    t.subscribe((state) => got.push(state));

    t.reset(); // -> уведомление (null, [])
    s.server(MSG.state, snapshot(5)); // поздний пакет уже после reset

    expect(got).toEqual([null]); // больше уведомлений нет
    expect(t.getState()).toBeNull();
  });

  it('reset отключает сокет, обнуляет состояние и уведомляет (null, [])', () => {
    const s = new FakeSocket();
    const t = new NetworkTransport(s, 'dev', seqIds());
    s.server(MSG.state, snapshot(1));
    const got: { state: GameState | null; events: DomainEvent[] }[] = [];
    t.subscribe((state, events) => got.push({ state, events }));

    t.reset();

    expect(s.disconnected).toBe(true);
    expect(t.getState()).toBeNull();
    expect(got).toEqual([{ state: null, events: [] }]);
  });
});
