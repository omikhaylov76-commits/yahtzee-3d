/**
 * Мост между Transport (ядро игры) и React (F2.3). Тонкий слой: НЕ содержит правил —
 * только хранит последнее состояние/события и проксирует действия в transport.
 * Это держит границы (architecture.md): ядро не знает про React, React не знает про reduce.
 */
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Category, DomainEvent, GameState } from '../core';
import type { Transport } from '../transport/Transport';
import { LocalTransport } from '../transport/LocalTransport';
import { LocalStorageGameStorage } from '../storage/localStorageGameStorage';

export interface GameStoreState {
  /** Текущее состояние партии (null — игра не начата). */
  state: GameState | null;
  /** События последнего действия (для звука/сочности в F5+). */
  events: DomainEvent[];
  newGame: (players: { name: string }[]) => void;
  roll: () => void;
  toggleHold: (index: number) => void;
  score: (category: Category) => void;
}

/** Собрать стор поверх произвольного транспорта (используется и в тестах с MemoryStorage). */
export function createGameStore(transport: Transport): StoreApi<GameStoreState> {
  const store = createStore<GameStoreState>(() => ({
    state: transport.getState(),
    events: [],
    newGame: (players) => transport.dispatch({ type: 'NEW_GAME', players }),
    roll: () => transport.dispatch({ type: 'ROLL' }),
    toggleHold: (index) => transport.dispatch({ type: 'TOGGLE_HOLD', index }),
    score: (category) => transport.dispatch({ type: 'SCORE', category }),
  }));

  // Обновления транспорта зеркалим в стор (состояние + события последнего действия).
  transport.subscribe((state, events) => store.setState({ state, events }));

  return store;
}

/** Дефолтный транспорт приложения: локальный + автосохранение в localStorage. */
const defaultTransport = new LocalTransport(new LocalStorageGameStorage());

/** Глобальный стор игры для React-приложения. */
export const gameStore = createGameStore(defaultTransport);

/** Хук для React-компонентов: подписка на срез стора. */
export function useGameStore<T>(selector: (s: GameStoreState) => T): T {
  return useStore(gameStore, selector);
}
