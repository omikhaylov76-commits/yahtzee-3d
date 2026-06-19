/**
 * Навигационный стор (2.L.a, ADR-0014): какой «вид» показывать вне активной партии.
 * ОТДЕЛЁН от gameStore намеренно — тот мост к ядру/transport, а это чистая UI-навигация.
 * Сюда добавятся онлайн-виды (лобби/кабинет/лидерборд) в под-шагах 2.2+.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { roomCodeFromUrl } from '../platform/deepLink';

export type View = 'menu' | 'localSetup' | 'online';

export interface UiState {
  /** Текущий вид, когда партии нет (есть партия — роутер показывает игру/итоги). */
  view: View;
  setView: (view: View) => void;
}

export const uiStore = createStore<UiState>((set) => ({
  // Deep-link `?room=CODE` (2.2.c-2): открываем экран входа, чтобы предзаполнить код; иначе — меню.
  view: roomCodeFromUrl() ? 'online' : 'menu',
  setView: (view) => set({ view }),
}));

/** Хук для React-компонентов: подписка на срез навигационного стора. */
export function useUiStore<T>(selector: (s: UiState) => T): T {
  return useStore(uiStore, selector);
}
