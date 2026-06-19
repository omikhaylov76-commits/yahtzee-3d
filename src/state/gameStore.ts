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
  /** Войти в онлайн: подменить активный транспорт сетевым (локальная партия/автосейв целы). */
  goOnline: () => void;
  /** Выйти из онлайна: отключить сетевой транспорт, вернуться на сохранённый локальный. */
  goLocal: () => void;
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
    roll: () => active.dispatch({ type: 'ROLL' }),
    toggleHold: (index) => active.dispatch({ type: 'TOGGLE_HOLD', index }),
    score: (category) => active.dispatch({ type: 'SCORE', category }),
    reset: () => {
      // В онлайне «сброс/выход в меню» = разорвать сетевую сессию и вернуться в локальный режим
      // (локальную партию/автосейв НЕ трогаем — они не были активны). Иначе `mode` залип бы в
      // 'online' с мёртвым транспортом: повторный онлайн и последующая локальная игра сломались бы.
      if (get().mode === 'online') get().goLocal();
      else active.reset();
    },
    mode: 'local',
    onlineStatus: null,
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
      switchTo(localTransport); // вернуться на сохранённую локальную партию (state её, не сетевой)
      set({ mode: 'local', onlineStatus: null });
    },
  }));

  // Зеркалим обновления АКТИВНОГО транспорта в стор; при свапе переподписываемся и сразу
  // показываем текущее состояние нового транспорта (события сбрасываем — это не игровое действие).
  function switchTo(next: Transport): void {
    unsub();
    active = next;
    unsub = active.subscribe((state, events) => store.setState({ state, events }));
    store.setState({ state: active.getState(), events: [] });
  }
  unsub = active.subscribe((state, events) => store.setState({ state, events }));

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
