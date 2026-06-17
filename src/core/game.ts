/**
 * «Движок хода» Yahtzee (F1, под-шаг 2). Чистый детерминированный reducer:
 * `reduce(state, action) -> { state, events }`. Единственный способ менять состояние игры
 * (ADR 0003). Значения костей определяет ядро через RNG (ADR 0004).
 *
 * Под-шаг 2 НЕ содержит правило джокера и бонусные Yahtzee — это добавляется в F1.3.
 */
import { isYahtzee, scoreCategory, totalScore } from './scoring';
import { rollDie } from './rng';
import {
  CATEGORIES,
  type Action,
  type Category,
  type Die,
  type DieValue,
  type DomainEvent,
  type GameState,
  type Player,
  type ReduceResult,
} from './types';

const DICE_COUNT = 5;
const MAX_ROLLS = 3;

/** Свежие кости в начале хода: все «1», не зафиксированы. */
function freshDice(): Die[] {
  return Array.from({ length: DICE_COUNT }, () => ({ value: 1 as DieValue, held: false }));
}

/** Значения костей текущего состояния. */
export function diceValues(state: GameState): DieValue[] {
  return state.dice.map((d) => d.value);
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.current];
}

/** Категории, ещё не записанные у текущего игрока. */
export function availableCategories(state: GameState): Category[] {
  const card = currentPlayer(state).card;
  return CATEGORIES.filter((c) => !(c in card));
}

/** Создать новую игру. seed обычно подаёт транспорт (случайный); по умолчанию — 1. */
export function createGame(players: { name: string }[], seed = 1): GameState {
  return {
    players: players.map((p, i) => ({
      id: `p${i}`,
      name: p.name,
      card: {},
      bonusYahtzees: 0,
    })),
    current: 0,
    dice: freshDice(),
    rollsLeft: MAX_ROLLS,
    rolledThisTurn: false,
    phase: 'playing',
    winnerIds: [],
    seed,
    rng: seed,
  };
}

function denied(state: GameState, reason: string): ReduceResult {
  return { state, events: [{ type: 'action:denied', reason }] };
}

/** Все ли карточки заполнены (13 категорий у каждого) — конец игры. */
function allCardsFull(players: Player[]): boolean {
  return players.every((p) => Object.keys(p.card).length === CATEGORIES.length);
}

/** Индексы победителей (максимальный итог; ничья -> несколько). */
function computeWinners(players: Player[]): number[] {
  const totals = players.map(totalScore);
  const max = Math.max(...totals);
  return totals.map((t, i) => (t === max ? i : -1)).filter((i) => i >= 0);
}

function applyRoll(state: GameState): ReduceResult {
  if (state.phase !== 'playing' || state.rollsLeft <= 0) {
    return denied(state, 'roll-not-allowed');
  }
  let rng = state.rng;
  const dice = state.dice.map((die) => {
    if (die.held) return die;
    const { value, state: next } = rollDie(rng);
    rng = next;
    return { value, held: die.held };
  });
  return {
    state: {
      ...state,
      dice,
      rng,
      rollsLeft: state.rollsLeft - 1,
      rolledThisTurn: true,
    },
    events: [{ type: 'dice:rolled' }],
  };
}

function applyToggleHold(state: GameState, index: number): ReduceResult {
  if (state.phase !== 'playing') return denied(state, 'game-over');
  if (!state.rolledThisTurn || state.rollsLeft <= 0) return denied(state, 'hold-not-allowed');
  if (index < 0 || index >= state.dice.length) return denied(state, 'bad-die-index');
  const dice = state.dice.map((die, i) => (i === index ? { ...die, held: !die.held } : die));
  const nowHeld = dice[index].held;
  return {
    state: { ...state, dice },
    events: [{ type: nowHeld ? 'die:held' : 'die:released', index }],
  };
}

function applyScore(state: GameState, category: Category): ReduceResult {
  if (state.phase !== 'playing') return denied(state, 'game-over');
  if (!state.rolledThisTurn) return denied(state, 'score-before-roll');
  const player = currentPlayer(state);
  if (category in player.card) return denied(state, 'category-taken');

  const values = diceValues(state);
  const points = scoreCategory(values, category);

  const events: DomainEvent[] = [];
  const updatedPlayer: Player = { ...player, card: { ...player.card, [category]: points } };
  if (category === 'yahtzee' && isYahtzee(values)) {
    events.push({ type: 'combo:yahtzee', player: state.current, bonus: false });
  }
  events.push({ type: 'score:written', player: state.current, category, points });

  const players = state.players.map((p, i) => (i === state.current ? updatedPlayer : p));

  // Конец игры?
  if (allCardsFull(players)) {
    const winnerIds = computeWinners(players);
    return {
      state: { ...state, players, phase: 'over', winnerIds, rolledThisTurn: false },
      events: [...events, { type: 'game:over', winnerIds }],
    };
  }

  // Передача хода следующему игроку.
  const next = (state.current + 1) % players.length;
  return {
    state: {
      ...state,
      players,
      current: next,
      dice: freshDice(),
      rollsLeft: MAX_ROLLS,
      rolledThisTurn: false,
    },
    events: [...events, { type: 'turn:changed', player: next }],
  };
}

/** Единственная точка изменения состояния игры. */
export function reduce(state: GameState, action: Action): ReduceResult {
  switch (action.type) {
    case 'NEW_GAME':
      return { state: createGame(action.players, action.seed), events: [] };
    case 'ROLL':
      return applyRoll(state);
    case 'TOGGLE_HOLD':
      return applyToggleHold(state, action.index);
    case 'SCORE':
      return applyScore(state, action.category);
  }
}
