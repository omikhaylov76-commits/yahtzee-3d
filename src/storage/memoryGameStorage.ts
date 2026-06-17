/**
 * Хранилище в памяти (без localStorage). Используется в тестах и как безопасный фолбэк,
 * когда localStorage недоступен (приватный режим/SSR). Хранит сериализованный снимок,
 * чтобы вести себя как настоящее персистентное хранилище (отдаёт копию, не ссылку).
 */
import type { GameState } from '../core';
import type { GameStorage } from './GameStorage';

export class MemoryGameStorage implements GameStorage {
  private data: string | null = null;

  save(state: GameState): void {
    this.data = JSON.stringify(state);
  }

  load(): GameState | null {
    return this.data ? (JSON.parse(this.data) as GameState) : null;
  }

  clear(): void {
    this.data = null;
  }
}
