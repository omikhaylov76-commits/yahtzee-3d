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
  private ambient: { gain: GainNode; oscs: OscillatorNode[]; lfo: OscillatorNode } | null = null;

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
      case 'score':
        this.bell(ctx, 880, 0.22, 0.7, ctx.currentTime + 0.005);
        break;
      case 'yahtzee':
        this.fanfare(ctx);
        break;
      case 'win':
        this.chord(ctx);
        break;
      case 'turn':
        this.swoosh(ctx);
        break;
      case 'denied':
        this.denied(ctx);
        break;
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

  /** Тихий эволюционирующий пэд: низкий аккорд + медленно плывущий фильтр. Идёт через master. */
  startAmbient(): void {
    const ctx = this.unlock();
    if (!ctx || this.ambient) return;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    filter.connect(gain);

    const freqs = [98, 147, 196]; // G2 / D3 / G3 — низкий тёплый аккорд
    const oscs = freqs.map((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr * (1 + (i - 1) * 0.0025); // лёгкий детюн для «живости»
      o.connect(filter);
      o.start();
      return o;
    });

    // медленная модуляция частоты фильтра — пэд «дышит»
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.6); // плавный fade-in
    this.ambient = { gain, oscs, lfo };
  }

  stopAmbient(): void {
    if (!this.ambient || !this.ctx) return;
    const { gain, oscs, lfo } = this.ambient;
    const t = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0.0001, t, 0.6);
    const stopAt = t + 2.2;
    oscs.forEach((o) => o.stop(stopAt));
    lfo.stop(stopAt);
    this.ambient = null;
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

  /** Колокольный тон: фундамент + негармоничные партиалы, мягкая атака, долгое затухание. */
  private bell(ctx: AudioContext, freq: number, peak: number, decay: number, t0: number): void {
    const partials: [number, number][] = [
      [1, 1],
      [2.0, 0.5],
      [2.76, 0.3],
      [3.9, 0.17],
      [5.4, 0.1],
    ];
    for (const [ratio, amp] of partials) {
      tone(ctx, this.bus, {
        freq: freq * ratio,
        type: 'sine',
        t0,
        attack: 0.006,
        decay: decay / Math.sqrt(ratio), // высокие партиалы гаснут быстрее → «живой» колокол
        peak: peak * amp,
      });
    }
  }

  /** Yahtzee: восходящая мини-фанфара колокольных тонов (мажорная пентатоника). */
  private fanfare(ctx: AudioContext): void {
    const notes = [523, 659, 784, 1047, 1319]; // C5 E5 G5 C6 E6
    notes.forEach((f, i) => {
      this.bell(ctx, f, 0.18, 0.55, ctx.currentTime + 0.005 + i * 0.085);
    });
  }

  /** Победа: тёплый сустейн-аккорд (G-dur: G B D + октава), мягкая атака, долгое затухание. */
  private chord(ctx: AudioContext): void {
    const t0 = ctx.currentTime + 0.005;
    const freqs = [392, 494, 587, 784]; // G4 B4 D5 G5
    freqs.forEach((f, i) => {
      tone(ctx, this.bus, {
        freq: f,
        type: 'triangle',
        t0: t0 + i * 0.04, // лёгкий арпеджированный заход
        attack: 0.02,
        decay: 1.6,
        peak: 0.16,
        filterType: 'lowpass',
        filterFreq: 2600,
      });
    });
  }

  /** Смена хода: тихий мягкий свуш — шум через bandpass с разверткой частоты. */
  private swoosh(ctx: AudioContext): void {
    const t0 = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(340, t0);
    f.frequency.exponentialRampToValueAtTime(1500, t0 + 0.17);
    f.frequency.exponentialRampToValueAtTime(520, t0 + 0.34);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.1, t0 + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    src.connect(f);
    f.connect(g);
    g.connect(this.bus);
    src.start(t0);
    src.stop(t0 + 0.4);
  }

  /** Отклонено: деликатный низкий «нельзя» — короткий приглушённый нисходящий тон. */
  private denied(ctx: AudioContext): void {
    const t0 = ctx.currentTime + 0.005;
    tone(ctx, this.bus, {
      freq: 200,
      freqEnd: 150,
      type: 'sine',
      t0,
      attack: 0.005,
      decay: 0.2,
      peak: 0.18,
      filterType: 'lowpass',
      filterFreq: 520,
    });
  }
}
