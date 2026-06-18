/**
 * Подключение игры Yahtzee к серверной платформе (граница платформа/игра, ADR-0011).
 * Тонкий адаптер: реализует `GameModule` поверх чистых функций ядра (`src/core`, добавлены в
 * 2.1.a) — правила/счёт НЕ переписываем, лишь оборачиваем в контракт, который вызывает платформа.
 */
import {
  createGame,
  reduce,
  isPlayersTurn,
  isGameOver,
  getResult,
  toPublicState,
  type Action,
  type DomainEvent,
  type GameResult,
  type GameState,
  type PublicGameState,
} from '../../../src/core';
import type { GameModule } from '../../platform/gameModule';

export const yahtzeeModule: GameModule<
  GameState,
  PublicGameState,
  Action,
  DomainEvent,
  GameResult
> = {
  id: 'yahtzee',
  createInitialState: (players, seed) => createGame(players, seed),
  reduce,
  isPlayersTurn,
  isGameOver,
  getResult,
  toPublicState,
};
