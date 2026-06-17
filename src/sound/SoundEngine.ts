/**
 * Контракт звукового слоя (architecture.md). Реализация — за интерфейсом: сейчас процедурный
 * Web Audio (ADR 0006), позже можно подменить на сэмплы/Howler без изменения остального кода.
 */

/** Доменно-нейтральные звуковые события (на них маппятся события ядра — см. soundMap.ts). */
export type SoundEvent =
  | 'dice' // бросок/удар костей о стол
  | 'hold' // фиксация кости
  | 'release' // снятие фиксации
  | 'score' // запись очков
  | 'yahtzee' // Yahtzee / крупная комбинация
  | 'win' // победа
  | 'turn' // смена хода
  | 'denied'; // действие отклонено

export interface SoundEngine {
  play(event: SoundEvent): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void; // 0..1
  startAmbient(): void;
  stopAmbient(): void;
}
