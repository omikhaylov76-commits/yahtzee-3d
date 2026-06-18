/**
 * Тесты авторитетной логики комнаты (2.1.b): идемпотентность, версионирование, авторизация хода,
 * инъекция CSPRNG-значений с уважением held, отказы правил ядра, обобщённый итог. Чистая логика —
 * без сокетов; модуль Yahtzee реальный (ядро чистое), `rollValues` детерминированы в тесте.
 */
import { describe, it, expect } from 'vitest';
import { applyNetworkAction, startGame } from './rooms';
import { rollDiceValues, randomSeed } from './rng';
import { yahtzeeModule } from '../games/yahtzee';
import type { ActionMessage } from '../../shared/protocol';
import type { DieValue } from '../../src/core';

const players = [
  { id: 'A', name: 'Alice' },
  { id: 'B', name: 'Bob' },
];
/** Детерминированный источник значений костей для теста (вместо CSPRNG). */
const roll =
  (...v: DieValue[]) =>
  () =>
    v;
const fresh = () => startGame(yahtzeeModule, players, 7); // current=0 -> ход игрока 'A'

describe('applyNetworkAction — версия и инъекция значений', () => {
  it('ROLL подставляет серверные значения и поднимает stateVersion', () => {
    const msg: ActionMessage = { action: { type: 'ROLL' }, actionId: 'a1' };
    const r = applyNetworkAction(yahtzeeModule, fresh(), 'A', msg, roll(1, 2, 3, 4, 5));

    expect(r.denied).toBeUndefined();
    expect(r.room.stateVersion).toBe(2);
    expect(r.room.state.dice.map((d) => d.value)).toEqual([1, 2, 3, 4, 5]);
    expect(r.events.some((e) => e.type === 'dice:rolled')).toBe(true);
  });

  it('инъекция уважает held-кости', () => {
    let room = fresh();
    room = applyNetworkAction(
      yahtzeeModule,
      room,
      'A',
      { action: { type: 'ROLL' }, actionId: 'a1' },
      roll(1, 2, 3, 4, 5),
    ).room;
    room = applyNetworkAction(
      yahtzeeModule,
      room,
      'A',
      { action: { type: 'TOGGLE_HOLD', index: 0 }, actionId: 'a2' },
      roll(),
    ).room;
    const r = applyNetworkAction(
      yahtzeeModule,
      room,
      'A',
      { action: { type: 'ROLL' }, actionId: 'a3' },
      roll(6, 6, 6, 6, 6),
    );

    expect(r.room.state.dice[0].value).toBe(1); // удержана
    expect(r.room.state.dice.slice(1).map((d) => d.value)).toEqual([6, 6, 6, 6]);
    expect(r.room.stateVersion).toBe(4); // roll(2) -> hold(3) -> roll(4)
  });
});

describe('applyNetworkAction — идемпотентность', () => {
  it('повтор того же actionId не меняет состояние (duplicate)', () => {
    const msg: ActionMessage = { action: { type: 'ROLL' }, actionId: 'a1' };
    const first = applyNetworkAction(yahtzeeModule, fresh(), 'A', msg, roll(1, 2, 3, 4, 5));
    const again = applyNetworkAction(yahtzeeModule, first.room, 'A', msg, roll(6, 6, 6, 6, 6));

    expect(again.duplicate).toBe(true);
    expect(again.room.stateVersion).toBe(2);
    expect(again.room.state.dice.map((d) => d.value)).toEqual([1, 2, 3, 4, 5]); // не перебросило
  });
});

describe('applyNetworkAction — авторизация и отказы', () => {
  it('чужой ход -> denied, версия не двигается', () => {
    const msg: ActionMessage = { action: { type: 'ROLL' }, actionId: 'b1' };
    const r = applyNetworkAction(yahtzeeModule, fresh(), 'B', msg, roll(1, 2, 3, 4, 5));

    expect(r.denied).toBe('not-your-turn');
    expect(r.room.stateVersion).toBe(1);
  });

  it('SCORE до броска -> отказ правила ядра, версия не двигается', () => {
    const msg: ActionMessage = { action: { type: 'SCORE', category: 'chance' }, actionId: 's1' };
    const r = applyNetworkAction(yahtzeeModule, fresh(), 'A', msg, roll());

    expect(r.denied).toBe('score-before-roll');
    expect(r.room.stateVersion).toBe(1);
  });

  it('запрещённый тип действия с провода (NEW_GAME) -> denied bad-action', () => {
    const bad = { action: { type: 'NEW_GAME' }, actionId: 'x1' };
    const r = applyNetworkAction(yahtzeeModule, fresh(), 'A', bad, roll());

    expect(r.denied).toBe('bad-action');
    expect(r.room.stateVersion).toBe(1);
  });
});

describe('валидация входа с провода (fix Critical-1 / Major-2)', () => {
  it('SCORE с несуществующей категорией -> bad-action (не пишет мусор, не мотает ход)', () => {
    const bad = { action: { type: 'SCORE', category: 'bogus' }, actionId: 'c1' };
    const r = applyNetworkAction(yahtzeeModule, fresh(), 'A', bad, roll());

    expect(r.denied).toBe('bad-action');
    expect(r.room.stateVersion).toBe(1);
    expect(r.room.state.current).toBe(0); // ход не ушёл
  });

  it('SCORE с category "__proto__" -> bad-action (не путается с прототипом карточки)', () => {
    const bad = { action: { type: 'SCORE', category: '__proto__' }, actionId: 'c2' };
    const r = applyNetworkAction(yahtzeeModule, fresh(), 'A', bad, roll());

    expect(r.denied).toBe('bad-action');
    expect(r.room.stateVersion).toBe(1);
  });

  it('TOGGLE_HOLD с нечисловым index -> bad-action', () => {
    const bad = { action: { type: 'TOGGLE_HOLD', index: '0' }, actionId: 'h1' };
    const r = applyNetworkAction(yahtzeeModule, fresh(), 'A', bad, roll());

    expect(r.denied).toBe('bad-action');
    expect(r.room.stateVersion).toBe(1);
  });

  it('кривой/неполный конверт не роняет обработчик и даёт bad-action', () => {
    const room = fresh();
    for (const bad of [
      undefined,
      null,
      {},
      { action: { type: 'ROLL' } }, // нет actionId
      { action: { type: 'ROLL' }, actionId: 123 }, // actionId не строка
      { action: { type: 'ROLL' }, actionId: '' }, // пустой actionId
      { actionId: 'z', action: null }, // нет action
      { actionId: 'z', action: { foo: 'bar' } }, // action без type
    ]) {
      const r = applyNetworkAction(yahtzeeModule, room, 'A', bad, roll(1, 2, 3, 4, 5));
      expect(r.denied).toBe('bad-action');
      expect(r.room.stateVersion).toBe(1);
    }
  });
});

describe('ход и итог', () => {
  it('SCORE передаёт ход следующему игроку (версия растёт)', () => {
    let room = fresh();
    room = applyNetworkAction(
      yahtzeeModule,
      room,
      'A',
      { action: { type: 'ROLL' }, actionId: 'a1' },
      roll(1, 1, 1, 1, 1),
    ).room;
    const r = applyNetworkAction(
      yahtzeeModule,
      room,
      'A',
      { action: { type: 'SCORE', category: 'ones' }, actionId: 'a2' },
      roll(),
    );

    expect(r.room.stateVersion).toBe(3);
    expect(yahtzeeModule.isPlayersTurn(r.room.state, 'B')).toBe(true);
    expect(yahtzeeModule.isPlayersTurn(r.room.state, 'A')).toBe(false);
  });

  it('getResult/isGameOver на старте партии', () => {
    const room = fresh();
    expect(yahtzeeModule.isGameOver(room.state)).toBe(false);
    const res = yahtzeeModule.getResult(room.state);
    expect(res.standings.map((s) => s.id)).toEqual(['A', 'B']);
    expect(res.standings.every((s) => s.total === 0)).toBe(true);
    expect(res.winnerIds).toEqual([]);
  });
});

describe('CSPRNG значений костей (rng.ts)', () => {
  it('rollDiceValues даёт нужное число костей 1..6', () => {
    for (let n = 0; n < 50; n++) {
      const v = rollDiceValues(5);
      expect(v).toHaveLength(5);
      expect(v.every((x) => x >= 1 && x <= 6)).toBe(true);
    }
  });

  it('randomSeed возвращает неотрицательное целое', () => {
    const s = randomSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});
