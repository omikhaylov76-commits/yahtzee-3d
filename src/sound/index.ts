/** Публичный API звукового слоя (F5): синглтон-движок + контракт/маппинг. */
export type { SoundEngine, SoundEvent } from './SoundEngine';
export { eventToSound } from './soundMap';
import { WebAudioSoundEngine } from './WebAudioSoundEngine';

/** Единственный экземпляр звукового движка для приложения. */
export const soundEngine = new WebAudioSoundEngine();
