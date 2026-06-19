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
import { createOnlineSession, type OnlineSession, type OnlineStatus } from '../platform/net';

export interface GameStoreState {
  /** Текущее состояние партии (null — игра не начата). */
  state: GameState | null;
  /** События последнего действия (для звука/сочности в F5+). */
  events: DomainEvent[];
  /**
   * Кости летят (физический бросок ещё не успокоился) — флаг слоя render3d, НЕ ядра.
   * Пока true, UI блокирует Roll/контролы; снимается, когда 3D эмитит «успокоились»
   * (architecture.md: dice:settled — событие render3d).
   */
  settling: boolean;
  /** Слой render3d выставляет/снимает флаг полёта костей. */
  setSettling: (settling: boolean) => void;
  /**
   * Счётчик «потрясти стол» (Nudge) — косметический толчок костей, НЕ Action ядра и НЕ меняет
   * значения (честность/сеть). Растёт на каждое нажатие; render3d реагирует на изменение.
   */
  nudgeNonce: number;
  /** UI зовёт, чтобы «вздрогнул стол» — кости подпрыгнут и доваляются на те же значения. */
  nudge: () => void;
  /** Настройки звука (F5): выключен ли звук и громкость 0..1. Сохраняются в localStorage. */
  muted: boolean;
  volume: number;
  /** Включён ли фоновый эмбиент (F5.2). Сохраняется в localStorage. */
  ambient: boolean;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  setAmbient: (ambient: boolean) => void;
  newGame: (players: { name: string }[]) => void;
  roll: () => void;
  toggleHold: (index: number) => void;
  score: (category: Category) => void;
  reset: () => void;
  /**
   * Режим активного транспорта (2.1.d-1). `local` — `LocalTransport` (hotseat/соло, автосейв);
   * `online` — `NetworkTransport` поверх сокета. UI-экраны режим не знают (ADR-0003).
   */
  mode: 'local' | 'online';
  /** Статус сетевой сессии для экрана соединения; null вне онлайна. */
  onlineStatus: OnlineStatus | null;
  /**
   * Стабильный id ЭТОГО клиента в сетевой партии (выдан сервером при входе); null в local или до
   * входа. UI гейтит «мой ход» по нему (2.1.d-3). Зеркалится с активного сетевого транспорта.
   */
  myPlayerId: string | null;
  /**
   * Сетевое действие «в полёте» — отправлено, ждём авторитетный ответ сервера (ADR-0013). Пока true,
   * UI блокирует контролы (анти-двойной Roll/Score). Всегда false в local-режиме (2.1.d-3).
   */
  pending: boolean;
  /** Войти в онлайн: подменить активный транспорт сетевым (локальная партия/автосейв целы). */
  goOnline: () => void;
  /** Выйти из онлайна: отключить сетевой транспорт, вернуться на сохранённый локальный. */
  goLocal: () => void;
}

/**
 * Узкий «сетевой» подмешок транспорта (его реализует `NetworkTransport`, но НЕ `LocalTransport`):
 * стор читает эти геттеры duck-typing'ом, не расширяя общий контракт `Transport` (2.1.d-3).
 */
interface NetworkAware {
  getPlayerId(): string | null;
  getPending(): boolean;
}

function isNetworkAware(t: unknown): t is NetworkAware {
  const c = t as Partial<NetworkAware>;
  return typeof c.getPlayerId === 'function' && typeof c.getPending === 'function';
}

const SOUND_KEY = 'yahtzee.sound.v1';

interface SoundSettings {
  muted: boolean;
  volume: number;
  ambient: boolean;
}

/** Прочитать настройки звука из localStorage (с безопасными значениями по умолчанию). */
function loadSound(): SoundSettings {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<SoundSettings>;
      return {
        muted: !!v.muted,
        volume: typeof v.volume === 'number' ? Math.max(0, Math.min(1, v.volume)) : 0.6,
        ambient: !!v.ambient,
      };
    }
  } catch {
    // повреждённые/недоступные данные — дефолт
  }
  return { muted: false, volume: 0.6, ambient: false };
}

function saveSound(s: SoundSettings): void {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(s));
  } catch {
    // localStorage недоступен — настройки живут в памяти сессии
  }
}

/**
 * Собрать стор поверх произвольного транспорта (используется и в тестах с MemoryStorage).
 * `makeOnlineSession` — фабрика онлайн-сессии; по умолчанию реальная (сокет+`NetworkTransport`),
 * в тестах подменяется фейком, чтобы проверить свап транспорта без сети (как инъекция сокета в 2.1.c).
 */
export function createGameStore(
  localTransport: Transport,
  makeOnlineSession: (
    onStatus: (status: OnlineStatus) => void,
  ) => OnlineSession = createOnlineSession,
): StoreApi<GameStoreState> {
  const sound = loadSound();

  // Активный транспорт можно подменять (local↔online, 2.1.d-1). Методы стора читают `active` в
  // момент вызова, поэтому свап прозрачен для UI. `localTransport` живёт всё время (его автосейв
  // не теряется при заходе в онлайн); сетевой транспорт создаётся на сессию.
  let active: Transport = localTransport;
  let session: OnlineSession | null = null;
  let unsub: () => void = () => {};

  const store = createStore<GameStoreState>((set, get) => ({
    state: active.getState(),
    events: [],
    settling: false,
    setSettling: (settling) => set({ settling }),
    nudgeNonce: 0,
    nudge: () => set((s) => ({ nudgeNonce: s.nudgeNonce + 1 })),
    muted: sound.muted,
    volume: sound.volume,
    ambient: sound.ambient,
    setMuted: (muted) => {
      set({ muted });
      saveSound({ muted, volume: get().volume, ambient: get().ambient });
    },
    setVolume: (volume) => {
      const v = Math.max(0, Math.min(1, volume));
      set({ volume: v });
      saveSound({ muted: get().muted, volume: v, ambient: get().ambient });
    },
    setAmbient: (ambient) => {
      set({ ambient });
      saveSound({ muted: get().muted, volume: get().volume, ambient });
    },
    newGame: (players) => active.dispatch({ type: 'NEW_GAME', players }),
    // После dispatch зеркалим сетевой `pending` (он синхронно встаёт в true), чтобы UI сразу
    // заблокировал контролы; снимется обратно в колбэке подписки при приходе состояния/denied (2.1.d-3).
    roll: () => {
      active.dispatch({ type: 'ROLL' });
      mirrorNet();
    },
    toggleHold: (index) => {
      active.dispatch({ type: 'TOGGLE_HOLD', index });
      mirrorNet();
    },
    score: (category) => {
      active.dispatch({ type: 'SCORE', category });
      mirrorNet();
    },
    reset: () => {
      // В онлайне «сброс/выход в меню» = разорвать сетевую сессию и вернуться в локальный режим
      // (локальную партию/автосейв НЕ трогаем — они не были активны). Иначе `mode` залип бы в
      // 'online' с мёртвым транспортом: повторный онлайн и последующая локальная игра сломались бы.
      if (get().mode === 'online') get().goLocal();
      else active.reset();
    },
    mode: 'local',
    onlineStatus: null,
    myPlayerId: null,
    pending: false,
    goOnline: () => {
      if (get().mode === 'online') return; // уже онлайн — повторный заход игнорируем
      session = makeOnlineSession((onlineStatus) => store.setState({ onlineStatus }));
      switchTo(session.transport);
      set({ mode: 'online', onlineStatus: 'connecting' });
    },
    goLocal: () => {
      if (get().mode === 'local') return;
      session?.dispose(); // отключить сокет + обнулить сетевой транспорт (2.1.c reset)
      session = null;
      // Возврат на локальный транспорт. ИНВАРИАНТ (важно для «выхода в меню», 2.1.d-2): онлайн
      // достижим ТОЛЬКО из меню, а меню роутер показывает лишь при `state===null` (App.tsx:
      // `state ? Game : view`). Значит пока мы онлайн, `localTransport` гарантированно пуст —
      // `getState()` здесь вернёт null, и «выход из онлайна» приведёт в меню, а не воскресит чужую
      // локальную партию. (Если инвариант когда-то ослабнет — пересмотреть этот путь.)
      switchTo(localTransport);
      set({ mode: 'local', onlineStatus: null });
    },
  }));

  // Зеркалим «сетевые» поля (мой id места + действие в полёте) с активного транспорта. В local
  // (или до входа) геттеров нет — поля сбрасываются в null/false, и гейтинг ввода выключен (2.1.d-3).
  function mirrorNet(): void {
    if (store.getState().mode === 'online' && isNetworkAware(active)) {
      store.setState({ myPlayerId: active.getPlayerId(), pending: active.getPending() });
    } else {
      store.setState({ myPlayerId: null, pending: false });
    }
  }

  // Зеркалим обновления АКТИВНОГО транспорта в стор; при свапе переподписываемся и сразу
  // показываем текущее состояние нового транспорта (события сбрасываем — это не игровое действие).
  function switchTo(next: Transport): void {
    unsub();
    active = next;
    unsub = active.subscribe((state, events) => {
      store.setState({ state, events });
      mirrorNet(); // приход авторитетного состояния/denied снимает pending, обновляет playerId
    });
    store.setState({ state: active.getState(), events: [] });
    mirrorNet();
  }
  unsub = active.subscribe((state, events) => {
    store.setState({ state, events });
    mirrorNet();
  });

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

/** Чей сейчас ход — это id ЭТОГО клиента (только в сети; в local понятие неприменимо). */
function isMyTurn(s: GameStoreState): boolean {
  const st = s.state;
  if (!st || s.myPlayerId == null) return false;
  return st.players[st.current]?.id === s.myPlayerId;
}

/**
 * Заблокирован ли пользовательский ввод (контролы Roll/Nudge/hold и запись очков). В сети — когда
 * нет живой партии (соединение/ожидание), действие в полёте (`pending`) или ход соперника. В local
 * всегда false — поведение Вехи 1 без изменений (2.1.d-3). Чистая функция: тестируется без React.
 */
export function selectInputLocked(s: GameStoreState): boolean {
  if (s.mode !== 'online') return false;
  if (s.onlineStatus !== 'playing') return true; // нет авторитетной партии (разрыв/ожидание)
  if (s.pending) return true; // ждём ответ сервера на наше действие
  return !isMyTurn(s);
}

/**
 * Текст баннера-подсказки для сетевой партии (или null — баннера нет). Приоритет: нет соединения →
 * ход соперника. `pending` баннера не показывает (краткий — достаточно блокировки кнопок) (2.1.d-3).
 */
export function selectTurnBanner(s: GameStoreState): string | null {
  if (s.mode !== 'online') return null;
  if (s.onlineStatus !== 'playing') return 'Connection lost — reconnecting…';
  // Пока сервер не сообщил наше место (`myPlayerId == null`), не утверждаем «ход соперника» — это
  // могло бы соврать в короткое окно реконнекта (2.1.e). Ввод всё равно заблокирован (fail-safe).
  if (s.myPlayerId == null || !s.state) return null;
  return isMyTurn(s) ? null : "Opponent's turn";
}

/** Хук: заблокирован ли ввод (см. `selectInputLocked`). Зовут `GameScreen` и `ScoreTable`. */
export function useInputLocked(): boolean {
  return useStore(gameStore, selectInputLocked);
}

/** Хук: текст баннера сетевой партии или null (см. `selectTurnBanner`). */
export function useTurnBanner(): string | null {
  return useStore(gameStore, selectTurnBanner);
}
