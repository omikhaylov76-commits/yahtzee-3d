/**
 * Контракт «действие/состояние» (ADR 0003) — единственная точка, через которую слои UI/3D/
 * звука общаются с игрой. Сейчас работает LocalTransport; для сети позже подставляется
 * NetworkTransport с тем же интерфейсом, без изменения ядра/UI.
 */
import type { Action, DomainEvent, GameState } from '../core';

/** Подписчик получает новое состояние и события, произошедшие при последнем действии. */
export type TransportListener = (state: GameState | null, events: DomainEvent[]) => void;

export interface Transport {
  /** Текущее состояние партии или null, если игра ещё не начата. */
  getState(): GameState | null;
  /** Отправить действие в игру. */
  dispatch(action: Action): void;
  /** Сбросить партию: очистить сохранение и вернуться к «нет партии» (экран старта). */
  reset(): void;
  /** Подписаться на обновления. Возвращает функцию отписки. */
  subscribe(listener: TransportListener): () => void;
}
