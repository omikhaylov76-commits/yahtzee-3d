/**
 * Процедурный звук на Web Audio (F5, ADR 0006). Ленивый AudioContext (создаётся/возобновляется
 * по жесту), master-gain (громкость/mute), общий реверб-send для глубины. Голоса синтезируются
 * в synth.ts. F5.1: dice / hold / release. Остальные звуки и эмбиент — F5.2.
 *
 * Реальные сэмплы (CC0) — позже: достаточно класть файлы и подменить голос за этим интерфейсом.
 */
import type { SoundEngine, SoundEvent } from './SoundEngine';
import { makeNoiseBuffer, makeReverbIR, noiseBurst, tone } from './synth';

export class WebAudioSoundEngine implements SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode; // голоса → bus → master (сухо) + reverbSend (влажно)
  private noise!: AudioBuffer;

  private muted = false;
  private volume = 0.6;

  /** Создать/возобновить контекст (по жесту). Безопасно вызывать многократно. */
  unlock(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.connect(ctx.destination);

      const convolver = ctx.createConvolver();
      convolver.buffer = makeReverbIR(ctx);
      convolver.connect(this.master);
      const reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.16; // общий «влажный» уровень (мало — звук твёрже, не «мокро»)
      reverbSend.connect(convolver);

      this.bus = ctx.createGain();
      this.bus.connect(this.master); // сухо
      this.bus.connect(reverbSend); // влажно

      this.noise = makeNoiseBuffer(ctx);
      this.applyGain(0);
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch {
      this.ctx = null;
      return null;
    }
  }

  private applyGain(ramp = 0.04): void {
    if (!this.ctx) return;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, ramp);
  }

  play(event: SoundEvent): void {
    const ctx = this.unlock();
    if (!ctx) return;
    switch (event) {
      case 'dice':
        this.dice(ctx);
        break;
      case 'hold':
        this.click(ctx, true);
        break;
      case 'release':
        this.click(ctx, false);
        break;
      // score / yahtzee / win / turn / denied — F5.2
      default:
        break;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  startAmbient(): void {
    // F5.2
  }

  stopAmbient(): void {
    // F5.2
  }

  // --- Голоса (процедурные) ----------------------------------------------

  /**
   * Бросок: натуральный раскат — серия контактов «кость о стол», с естественной кластеризацией
   * по времени и затуханием энергии (как реальная горсть костей, что бьётся и докатывается).
   */
  private dice(ctx: AudioContext): void {
    const n = 3 + Math.floor(Math.random() * 3); // 3–5 контактов (меньше «тиков»)
    let t = ctx.currentTime + 0.01;
    for (let i = 0; i < n; i++) {
      const level = (0.95 - i * 0.1) * (0.85 + Math.random() * 0.3);
      this.clack(ctx, t, level);
      // интервалы растут к концу (докатываются и реже стучат) + джиттер
      t += 0.03 + i * 0.01 + Math.random() * 0.07;
    }
  }

  /**
   * Один контакт кости о стол: резкий контактный «тик» (высокий короткий шум) + резонансное
   * «тело» — полый стук кости/дерева (узкополосный шум с Q, частота слегка варьируется).
   * Никакого тонального осциллятора (он звучал бы как барабан) и не «голый» белый шум.
   */
  private clack(ctx: AudioContext, t0: number, level: number): void {
    const lvl = Math.max(0.18, level);

    // твёрдое «тело» стука — низко-средний резонанс, короткий, без звона (тверже/глуше)
    const body = 230 + Math.random() * 240; // 230–470 Гц
    noiseBurst(ctx, this.bus, {
      buffer: this.noise,
      t0,
      attack: 0.0008,
      decay: 0.04 + Math.random() * 0.025,
      peak: 0.62 * lvl,
      filterType: 'bandpass',
      filterFreq: body,
      filterQ: 2.6,
    });
    // лёгкий приглушённый контакт (без яркого высокого «тика»)
    noiseBurst(ctx, this.bus, {
      buffer: this.noise,
      t0,
      attack: 0.0006,
      decay: 0.014,
      peak: 0.14 * lvl,
      filterType: 'lowpass',
      filterFreq: 1400,
    });
  }

  /** Фиксация/снятие: мягкий «поп» с питч-блипом (вверх — held, вниз — release) + лёгкий тик. */
  private click(ctx: AudioContext, up: boolean): void {
    const t0 = ctx.currentTime + 0.005;
    tone(ctx, this.bus, {
      freq: up ? 540 : 660,
      freqEnd: up ? 800 : 440,
      type: 'triangle',
      t0,
      attack: 0.004,
      decay: 0.12,
      peak: 0.34,
      filterType: 'lowpass',
      filterFreq: 2400,
    });
    noiseBurst(ctx, this.bus, {
      buffer: this.noise,
      t0,
      attack: 0.0005,
      decay: 0.02,
      peak: 0.12,
      filterType: 'bandpass',
      filterFreq: 2200,
      filterQ: 0.8,
    });
  }
}
