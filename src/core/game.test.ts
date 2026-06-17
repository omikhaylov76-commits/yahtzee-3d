import { describe, it, expect } from 'vitest';
import { createGame, reduce, diceValues, availableCategories, currentPlayer } from './game';
import { totalScore } from './scoring';

const newGame = (seed = 42) => createGame([{ name: 'A' }, { name: 'B' }], seed);

describe('createGame', () => {
  it('начальное состояние корректно', () => {
    const g = newGame();
    expect(g.players).toHaveLength(2);
    expect(g.players[0]).toMatchObject({ id: 'p0', name: 'A', card: {}, bonusYahtzees: 0 });
    expect(g.dice).toHaveLength(5);
    expect(g.rollsLeft).toBe(3);
    expect(g.rolledThisTurn).toBe(false);
    expect(g.phase).toBe('playing');
    expect(g.current).toBe(0);
  });
});

describe('ROLL', () => {
  it('детерминирован по seed (одинаковый seed -> одинаковые кости)', () => {
    const a = reduce(newGame(7), { type: 'ROLL' });
    const b = reduce(newGame(7), { type: 'ROLL' });
    expect(diceValues(a.state)).toEqual(diceValues(b.state));
  });

  it('разные seed дают (как правило) разные броски', () => {
    const a = reduce(newGame(1), { type: 'ROLL' });
    const b = reduce(newGame(999), { type: 'ROLL' });
    expect(diceValues(a.state)).not.toEqual(diceValues(b.state));
  });

  it('уменьшает rollsLeft, ставит rolledThisTurn, значения 1..6, событие dice:rolled', () => {
    const r = reduce(newGame(), { type: 'ROLL' });
    expect(r.state.rollsLeft).toBe(2);
    expect(r.state.rolledThisTurn).toBe(true);
    for (const v of diceValues(r.state)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
    expect(r.events).toContainEqual({ type: 'dice:rolled' });
  });

  it('зафиксированные кости не меняются при перебросе', () => {
    const r1 = reduce(newGame(), { type: 'ROLL' });
    const held = reduce(r1.state, { type: 'TOGGLE_HOLD', index: 0 });
    const r2 = reduce(held.state, { type: 'ROLL' });
    expect(r2.state.dice[0].value).toBe(r1.state.dice[0].value);
    expect(r2.state.dice[0].held).toBe(true);
  });

  it('запрещает 4-й бросок', () => {
    let r = reduce(newGame(), { type: 'ROLL' });
    r = reduce(r.state, { type: 'ROLL' });
    r = reduce(r.state, { type: 'ROLL' });
    expect(r.state.rollsLeft).toBe(0);
    const fourth = reduce(r.state, { type: 'ROLL' });
    expect(fourth.events).toContainEqual({ type: 'action:denied', reason: 'roll-not-allowed' });
    expect(fourth.state.rollsLeft).toBe(0);
  });
});

describe('TOGGLE_HOLD', () => {
  it('запрещён до первого броска', () => {
    const r = reduce(newGame(), { type: 'TOGGLE_HOLD', index: 0 });
    expect(r.events).toContainEqual({ type: 'action:denied', reason: 'hold-not-allowed' });
  });

  it('переключает фиксацию и шлёт событие', () => {
    const rolled = reduce(newGame(), { type: 'ROLL' });
    const hold = reduce(rolled.state, { type: 'TOGGLE_HOLD', index: 2 });
    expect(hold.state.dice[2].held).toBe(true);
    expect(hold.events).toContainEqual({ type: 'die:held', index: 2 });
    const release = reduce(hold.state, { type: 'TOGGLE_HOLD', index: 2 });
    expect(release.state.dice[2].held).toBe(false);
    expect(release.events).toContainEqual({ type: 'die:released', index: 2 });
  });
});

describe('SCORE', () => {
  it('запрещён до броска', () => {
    const r = reduce(newGame(), { type: 'SCORE', category: 'chance' });
    expect(r.events).toContainEqual({ type: 'action:denied', reason: 'score-before-roll' });
  });

  it('записывает очки, передаёт ход и сбрасывает кости', () => {
    const rolled = reduce(newGame(), { type: 'ROLL' });
    const scored = reduce(rolled.state, { type: 'SCORE', category: 'chance' });
    expect('chance' in scored.state.players[0].card).toBe(true);
    expect(scored.state.current).toBe(1);
    expect(scored.state.rollsLeft).toBe(3);
    expect(scored.state.rolledThisTurn).toBe(false);
    expect(scored.events.some((e) => e.type === 'score:written')).toBe(true);
    expect(scored.events).toContainEqual({ type: 'turn:changed', player: 1 });
  });

  it('запрещает запись в занятую категорию', () => {
    const rolled = reduce(newGame(), { type: 'ROLL' });
    const scored = reduce(rolled.state, { type: 'SCORE', category: 'chance' });
    // вернёмся к игроку 0: сыграем ход игрока 1
    const p1roll = reduce(scored.state, { type: 'ROLL' });
    const p1score = reduce(p1roll.state, { type: 'SCORE', category: 'chance' });
    const p0roll = reduce(p1score.state, { type: 'ROLL' });
    const taken = reduce(p0roll.state, { type: 'SCORE', category: 'chance' });
    expect(taken.events).toContainEqual({ type: 'action:denied', reason: 'category-taken' });
  });
});

describe('полный матч', () => {
  it('проходит до конца и определяет победителя', () => {
    let r = { state: newGame(123), events: [] as never[] } as ReturnType<typeof reduce>;
    let guard = 0;
    while (r.state.phase === 'playing' && guard < 100) {
      guard++;
      r = reduce(r.state, { type: 'ROLL' });
      const cat = availableCategories(r.state)[0];
      r = reduce(r.state, { type: 'SCORE', category: cat });
    }
    expect(r.state.phase).toBe('over');
    // у каждого по 13 категорий
    for (const p of r.state.players) expect(Object.keys(p.card)).toHaveLength(13);
    expect(r.state.winnerIds.length).toBeGreaterThanOrEqual(1);
    // победитель действительно имеет максимальный итог
    const totals = r.state.players.map(totalScore);
    const max = Math.max(...totals);
    for (const w of r.state.winnerIds) expect(totals[w]).toBe(max);
    expect(r.events).toContainEqual({ type: 'game:over', winnerIds: r.state.winnerIds });
  });
});

describe('availableCategories / currentPlayer', () => {
  it('availableCategories сужается после записи', () => {
    const g = newGame();
    expect(availableCategories(g)).toHaveLength(13);
    const rolled = reduce(g, { type: 'ROLL' });
    const scored = reduce(rolled.state, { type: 'SCORE', category: 'ones' });
    // ход у игрока 1 (его карта пуста) -> снова 13
    expect(currentPlayer(scored.state).name).toBe('B');
    expect(availableCategories(scored.state)).toHaveLength(13);
  });
});
