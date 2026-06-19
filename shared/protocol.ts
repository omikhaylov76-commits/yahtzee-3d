/**
 * Общий контракт сетевого протокола платформы (ADR-0013). Импортируется И клиентом (src/),
 * И сервером (server/). Держать ЧИСТЫМ: без DOM/Node-специфики — только данные/типы.
 *
 * Версия протокола проверяется в рукопожатии Socket.IO (2.0.c): несовпадение клиента и сервера
 * -> «обнови страницу», действия не обрабатываются (граница безопасности, ADR-0013).
 *
 * v2 (2.1.b): добавлены реальные игровые сообщения (вход в комнату, действия, рассылка
 * состояния с версией). v1 был «hello world» (только рукопожатие) — с v2 он несовместим.
 */
import type { Category, DomainEvent, PublicGameState } from '../src/core';

export const PROTOCOL_VERSION = 2;

/** Имена сокет-сообщений (одна точка истины для клиента и сервера). */
export const MSG = {
  // клиент -> сервер
  join: 'room:join',
  action: 'action',
  // сервер -> клиент
  joined: 'room:joined',
  full: 'room:full',
  notFound: 'room:not-found',
  state: 'state',
  denied: 'denied',
} as const;

/**
 * Действие игрока ПО СЕТИ — намеренно УЖЕ ядрового `Action`:
 * - нет `NEW_GAME` (партию создаёт только сервер при сборе игроков);
 * - у `ROLL` нет `values` (значения костей подставляет сервер из CSPRNG, ADR-0012) — клиент
 *   не может навязать выпавшие кости.
 */
export type NetworkAction =
  | { type: 'ROLL' }
  | { type: 'TOGGLE_HOLD'; index: number }
  | { type: 'SCORE'; category: Category };

/** Конверт действия с идемпотентным идентификатором (ADR-0013): повтор сервер игнорирует. */
export interface ActionMessage {
  action: NetworkAction;
  actionId: string;
}

/** Запрос на вход в комнату. В 2.1 `roomId` — общий литерал (коды/лобби — 2.2). */
export interface JoinRequest {
  roomId: string;
  name?: string;
  /**
   * Reclaim места при РЕконнекте (2.1.e-2): вернувшийся клиент называет свой `playerId` (выданный
   * сервером при первом входе), чтобы сервер вернул его в удерживаемое место идущей партии, а не
   * отбил `room:full`. Первый вход — без поля. Полноценный reconnect-токен на место — 2.4.c.
   */
  playerId?: string;
}

/** Подтверждение посадки: стабильный `playerId` места (для авторизации действий) и индекс места. */
export interface JoinedPayload {
  roomId: string;
  playerId: string;
  seat: number;
}

/**
 * Снимок авторитетного состояния (ADR-0013). Клиент применяет, ТОЛЬКО если `stateVersion`
 * больше уже применённой. `state` — публичное (без `seed`/`rng`). `events` едут вместе со
 * своим состоянием, чтобы одиночные события (`combo:yahtzee`) не терялись между апдейтами.
 */
export interface StatePayload {
  stateVersion: number;
  state: PublicGameState;
  events: DomainEvent[];
}

/** Отказ в действии — unicast автору (не в общий поток комнаты). */
export interface DeniedPayload {
  reason: string;
  actionId?: string;
}
