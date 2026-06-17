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

/** Собрать стор поверх произвольного транспорта (используется и в тестах с MemoryStorage). */
export function createGameStore(transport: Transport): StoreApi<GameStoreState> {
  const sound = loadSound();
  const store = createStore<GameStoreState>((set, get) => ({
    state: transport.getState(),
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
    newGame: (players) => transport.dispatch({ type: 'NEW_GAME', players }),
    roll: () => transport.dispatch({ type: 'ROLL' }),
    toggleHold: (index) => transport.dispatch({ type: 'TOGGLE_HOLD', index }),
    score: (category) => transport.dispatch({ type: 'SCORE', category }),
    reset: () => transport.reset(),
  }));

  // Обновления транспорта зеркалим в стор (состояние + события последнего действия).
  transport.subscribe((state, events) => store.setState({ state, events }));

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
