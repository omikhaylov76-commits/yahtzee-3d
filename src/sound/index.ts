/** Публичный API звукового слоя (F5): синглтон-движок + контракт/маппинг. */
export type { SoundEngine, SoundEvent } from './SoundEngine';
export { eventToSound } from './soundMap';
import type { SoundEngine } from './SoundEngine';
import { WebAudioSoundEngine } from './WebAudioSoundEngine';

/** Единственный экземпляр звукового движка — типизирован КОНТРАКТОМ, чтобы UI не зависел
 *  от конкретной реализации (замена на сэмплы/Howler за тем же интерфейсом). */
export const soundEngine: SoundEngine = new WebAudioSoundEngine();
