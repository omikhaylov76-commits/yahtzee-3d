/**
 * Сетевой транспорт (2.1.c, ADR-0003/0009/0013): реализует тот же интерфейс `Transport`, что и
 * `LocalTransport`, но источник истины — авторитетный сервер 2.1.b. Говорит по Socket.IO, кэширует
 * приходящее ПУБЛИЧНОЕ состояние (без `seed`/`rng`), гейтит действия по `pending` и отбраковывает
 * устаревшие версии состояния (ADR-0013). Ядро/`LocalTransport`/UI не знают, локальная игра или сеть.
 *
 * Подключение в приложение (переключение режима online↔local, экраны соединения, блокировка кнопок
 * по `pending`) — 2.1.d. Здесь только сам транспорт; сокет инъецируется (тестируемость).
 */
import {
  MSG,
  type DeniedPayload,
  type JoinedPayload,
  type NetworkAction,
  type StatePayload,
} from '../../shared/protocol';
import type { Action, DomainEvent, GameState, PublicGameState } from '../core';
import type { Transport, TransportListener } from './Transport';

/**
 * Узкий контракт сокета, нужный транспорту. Его удовлетворяет `Socket` из `socket.io-client`
 * (фабрика реального сокета — 2.1.d), а в тестах подставляется фейк.
 */
export interface TransportSocket {
  on(event: string, listener: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
  disconnect(): void;
}

const DEFAULT_ROOM = 'dev'; // 2.1: общая комната; коды/лобби — 2.2.

/** `Action` ядра -> сетевое действие. `ROLL` без значений (их даёт сервер из CSPRNG, ADR-0012). */
function toNetworkAction(action: Action): NetworkAction | null {
  switch (action.type) {
    case 'ROLL':
      return { type: 'ROLL' };
    case 'TOGGLE_HOLD':
      return { type: 'TOGGLE_HOLD', index: action.index };
    case 'SCORE':
      return { type: 'SCORE', category: action.category };
    default:
      return null; // NEW_GAME сюда не доходит (отсечён в dispatch — партию создаёт сервер)
  }
}

export class NetworkTransport implements Transport {
  private publicState: PublicGameState | null = null;
  private stateVersion = 0;
  /** `actionId` действия «в полёте» (ADR-0013): пока не null — новые действия игнорируются. */
  private pendingActionId: string | null = null;
  private playerId: string | null = null;
  /** После `reset()` — true: входящие сокет-события игнорируются (нет `off`, чтобы не воскресить). */
  private disposed = false;
  private readonly listeners = new Set<TransportListener>();

  constructor(
    private readonly socket: TransportSocket,
    roomId: string = DEFAULT_ROOM,
    private readonly makeActionId: () => string = () => crypto.randomUUID(),
  ) {
    socket.on(MSG.state, (p) => this.onState(p as StatePayload));
    socket.on(MSG.denied, (p) => this.onDenied(p as DeniedPayload));
    socket.on(MSG.joined, (p) => {
      this.playerId = (p as JoinedPayload).playerId;
    });
    // room:full / room:not-found — продуктовые состояния (2.2.d); здесь игнорируем.
    socket.emit(MSG.join, { roomId });
  }

  getState(): GameState | null {
    // Кэш — публичное состояние без `seed`/`rng` (сервер их срезает). UI эти поля не читает; отдаём
    // как `GameState` через документированный каст, не меняя контракт `Transport`/`LocalTransport`.
    return this.publicState as GameState | null;
  }

  dispatch(action: Action): void {
    if (this.disposed) return; // после reset транспорт «мёртв» (сокет отключён)
    if (action.type === 'NEW_GAME') return; // партию создаёт сервер (авто-старт), клиент не шлёт
    if (this.pendingActionId) return; // in-flight гейт (ADR-0013): без двойных Roll/Score
    const net = toNetworkAction(action);
    if (!net) return;
    const actionId = this.makeActionId();
    this.pendingActionId = actionId;
    this.socket.emit(MSG.action, { action: net, actionId });
  }

  reset(): void {
    this.disposed = true; // глушим входящие сокет-события до disconnect (анти-«воскрешение», Major-1)
    this.socket.disconnect();
    this.publicState = null;
    this.stateVersion = 0;
    this.pendingActionId = null;
    this.playerId = null;
    this.emit(null, []);
  }

  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Чей стабильный id у этого клиента (выдан сервером при входе). Пригодится UI в 2.1.d. */
  getPlayerId(): string | null {
    return this.playerId;
  }

  private onState(payload: StatePayload): void {
    if (this.disposed) return; // поздний пакет после reset не должен воскресить партию (Major-1)
    if (payload.stateVersion <= this.stateVersion) return; // устаревшее/дубль — игнор (ADR-0013)
    this.publicState = payload.state;
    this.stateVersion = payload.stateVersion;
    this.pendingActionId = null; // пришло авторитетное состояние — действие разрешилось
    this.emit(this.getState(), payload.events);
  }

  private onDenied(payload: DeniedPayload): void {
    if (this.disposed) return;
    // `denied` приходит unicast автору (ADR-0013) — реагируем ТОЛЬКО если это ответ на наше in-flight
    // действие (иначе дубль denied дал бы двойной «отказ»). Снимаем гейт и эмитим `action:denied` —
    // Веха 1 уже играет на него «отказ» (звук не дублируем).
    if (!this.pendingActionId) return;
    if (payload.actionId != null && payload.actionId !== this.pendingActionId) return;
    this.pendingActionId = null;
    this.emit(this.getState(), [{ type: 'action:denied', reason: payload.reason }]);
  }

  private emit(state: GameState | null, events: DomainEvent[]): void {
    for (const listener of this.listeners) listener(state, events);
  }
}
