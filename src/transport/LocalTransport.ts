/**
 * Локальный транспорт (ADR 0003): прогоняет действия через ядро в этом же процессе,
 * сохраняет партию через GameStorage и уведомляет подписчиков (состояние + события).
 * При создании восстанавливает партию из хранилища (автосохранение, ADR 0005).
 *
 * Случайный seed для NEW_GAME подставляется ЗДЕСЬ, на границе — ядро остаётся чистым
 * (ADR 0004). Генератор seed инъекцируется ради детерминизма тестов.
 */
import { createGame, reduce, type Action, type DomainEvent, type GameState } from '../core';
import type { GameStorage } from '../storage/GameStorage';
import type { Transport, TransportListener } from './Transport';

function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

export class LocalTransport implements Transport {
  private state: GameState | null;
  private readonly listeners = new Set<TransportListener>();

  constructor(
    private readonly storage: GameStorage,
    private readonly makeSeed: () => number = randomSeed,
  ) {
    this.state = storage.load();
  }

  getState(): GameState | null {
    return this.state;
  }

  dispatch(action: Action): void {
    let events: DomainEvent[];

    if (action.type === 'NEW_GAME') {
      const seed = action.seed ?? this.makeSeed();
      this.state = createGame(action.players, seed);
      events = [];
    } else {
      if (!this.state) return; // нет активной партии — действие игнорируется
      const result = reduce(this.state, action);
      this.state = result.state;
      events = result.events;
    }

    this.persist();
    this.emit(events);
  }

  reset(): void {
    this.state = null;
    this.storage.clear();
    this.emit([]);
  }

  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persist(): void {
    if (this.state) this.storage.save(this.state);
  }

  private emit(events: DomainEvent[]): void {
    for (const listener of this.listeners) listener(this.state, events);
  }
}
