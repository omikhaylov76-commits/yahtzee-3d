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
  type NetworkAction,
  type StatePayload,
} from '../../shared/protocol';
import type { Action, DomainEvent, GameState, PublicGameState } from '../core';
import type { Transport, TransportListener } from './Transport';
import { deniedSchema, joinedSchema, resetSchema, stateSchema } from '../../shared/schemas';

/**
 * Узкий контракт сокета, нужный транспорту. Его удовлетворяет `Socket` из `socket.io-client`
 * (фабрика реального сокета — 2.1.d), а в тестах подставляется фейк.
 */
export interface TransportSocket {
  on(event: string, listener: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
  disconnect(): void;
}

/**
 * Намерение входа в онлайн (2.2.a-2): создать новую комнату (код выдаст сервер) или войти в
 * существующую по коду. Имя — опционально (сервер чистит его `cleanName`; полная валидация — 2.2.b).
 */
export type OnlineIntent =
  | { type: 'create'; name?: string }
  | { type: 'join'; code: string; name?: string };

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
  /** Код комнаты: для `join` известен сразу, для `create` узнаём из `joined`. Нужен для reclaim. */
  private code: string | null;
  /** После `reset()` — true: входящие сокет-события игнорируются (нет `off`, чтобы не воскресить). */
  private disposed = false;
  private readonly listeners = new Set<TransportListener>();

  constructor(
    private readonly socket: TransportSocket,
    private readonly intent: OnlineIntent,
    private readonly makeActionId: () => string = () => crypto.randomUUID(),
  ) {
    this.code = intent.type === 'join' ? intent.code : null;
    socket.on(MSG.state, (p) => {
      // Оболочку проверяем (2.3.c-4); глубину публичного состояния доверяем своему серверу.
      if (stateSchema.safeParse(p).success) this.onState(p as StatePayload);
    });
    socket.on(MSG.denied, (p) => {
      const v = deniedSchema.safeParse(p);
      if (v.success) this.onDenied(v.data);
    });
    socket.on(MSG.joined, (p) => {
      const v = joinedSchema.safeParse(p);
      if (!v.success) return;
      this.playerId = v.data.playerId;
      this.code = v.data.roomId; // для create узнаём выданный код; для join — подтверждаем нормализованный
    });
    // Стол вернулся в лобби после завершившейся партии (ADR-0016, реванш, open/persistent): гасим
    // состояние игры, НЕ роняя сокет/playerId/код — следом придёт room:lobby и роутер покажет лобби (2.5.a-2).
    socket.on(MSG.reset, (p) => {
      if (resetSchema.safeParse(p).success) this.onReset();
    });
    // Вход в комнату — на КАЖДЫЙ (ре)коннект сокета (2.1.e-2). socket.io сам переподключается после
    // блипа сети; первый раз создаём/входим по intent, на реконнекте называем playerId+код (reclaim).
    socket.on('connect', () => this.enter());
    // room:full / not-found / already-started — статусы сессии (net.ts/2.2.a-3); здесь игнорируем.
  }

  /**
   * (Пере)войти на (ре)коннект сокета. Реклейм (playerId+код уже есть) → join с ними. Первый вход —
   * по intent: create (код выдаст сервер) или join по коду. Сбрасываем застрявший pending: авторитетный
   * re-snapshot его разрулит (долетело — придёт версией выше и снимет; потеряно — даём повторить).
   */
  private enter(): void {
    if (this.disposed) return; // после reset сессию не воскрешаем
    this.pendingActionId = null;
    if (this.playerId && this.code) {
      // Реклейм: идущую партию сервер вернёт по playerId (имя там уже сохранено). Но реконнект в ЛОББИ
      // место не держит (fresh-join) — поэтому имя пробрасываем тоже, иначе оно сбросится на «Player N».
      const { name } = this.intent;
      this.socket.emit(
        MSG.join,
        name
          ? { roomId: this.code, playerId: this.playerId, name }
          : { roomId: this.code, playerId: this.playerId },
      );
      return;
    }
    if (this.intent.type === 'create') {
      this.socket.emit(MSG.create, this.intent.name ? { name: this.intent.name } : {});
    } else {
      const { code, name } = this.intent;
      this.socket.emit(MSG.join, name ? { roomId: code, name } : { roomId: code });
    }
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

  /** Чей стабильный id у этого клиента (выдан сервером при входе). UI гейтит ход по нему (2.1.d-3). */
  getPlayerId(): string | null {
    return this.playerId;
  }

  /** Есть ли действие «в полёте» (ADR-0013). UI блокирует контролы, пока ждём ответ сервера (2.1.d-3). */
  getPending(): boolean {
    return this.pendingActionId !== null;
  }

  private onState(payload: StatePayload): void {
    if (this.disposed) return; // поздний пакет после reset не должен воскресить партию (Major-1)
    if (payload.stateVersion <= this.stateVersion) return; // устаревшее/дубль — игнор (ADR-0013)
    this.publicState = payload.state;
    this.stateVersion = payload.stateVersion;
    this.pendingActionId = null; // пришло авторитетное состояние — действие разрешилось
    this.emit(this.getState(), payload.events);
  }

  /**
   * Стол вернулся в лобби после партии (ADR-0016, реванш) — гасим состояние игры, НЕ роняя сокет/
   * playerId/код (это НЕ `reset()` сессии — мы остаёмся в комнате). Версию обнуляем, чтобы СЛЕДУЮЩАЯ
   * партия (она начнётся снова с версии 1) не была отброшена как устаревшая в `onState`. Подписчикам —
   * (null, []) → стор выставит `state=null`, роутер уведёт с экрана победителя в лобби.
   */
  private onReset(): void {
    if (this.disposed) return;
    this.publicState = null;
    this.stateVersion = 0;
    this.pendingActionId = null;
    this.emit(null, []);
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
