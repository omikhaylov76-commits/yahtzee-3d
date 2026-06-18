/**
 * Реализация GameStorage поверх Web Storage (localStorage). Версионированный ключ +
 * конверт с версией: при смене формата старые данные не ломают новую игру (load -> null).
 * Все операции в try/catch — приватный режим/превышение квоты не должны ронять игру.
 * Объект Storage инъекцируется (по умолчанию globalThis.localStorage) — удобно для тестов.
 */
import type { GameState } from '../core';
import type { GameStorage } from './GameStorage';

export const STORAGE_VERSION = 1;
export const STORAGE_KEY = `yahtzee3d:v${STORAGE_VERSION}:game`;

interface Envelope {
  version: number;
  state: GameState;
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Проверка формы загруженного состояния (защита от мусора/чужих/протухших данных). Проверяем
 * не только типы, но и инварианты, на которые опирается UI: непустой список игроков, индекс
 * текущего в диапазоне, ровно 5 костей, валидная фаза. Иначе экран игры падал бы при рендере
 * (`players[current].name`) — а верхнего ErrorBoundary нет. Битые данные -> начинаем заново.
 */
function looksLikeGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const g = value as Record<string, unknown>;
  if (!Array.isArray(g.players) || g.players.length < 1) return false;
  if (!Array.isArray(g.dice) || g.dice.length !== 5) return false;
  if (g.phase !== 'playing' && g.phase !== 'over') return false;
  if (typeof g.current !== 'number' || g.current < 0 || g.current >= g.players.length) return false;
  return true;
}

export class LocalStorageGameStorage implements GameStorage {
  private readonly storage: Storage | null;

  constructor(
    storage: Storage | null = defaultStorage(),
    private readonly key: string = STORAGE_KEY,
  ) {
    this.storage = storage;
  }

  save(state: GameState): void {
    if (!this.storage) return;
    try {
      const envelope: Envelope = { version: STORAGE_VERSION, state };
      this.storage.setItem(this.key, JSON.stringify(envelope));
    } catch {
      /* квота/приватный режим — тихо игнорируем */
    }
  }

  load(): GameState | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const envelope = JSON.parse(raw) as Partial<Envelope>;
      if (!envelope || envelope.version !== STORAGE_VERSION) return null;
      if (!looksLikeGameState(envelope.state)) return null;
      return envelope.state;
    } catch {
      return null;
    }
  }

  clear(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* игнорируем */
    }
  }
}
