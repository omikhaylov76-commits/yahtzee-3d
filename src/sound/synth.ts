/**
 * Web Audio синтез-помощники (F5): мягкие огибающие, фильтрованные тоны, шум, реверб-IR.
 * Цель — тёплый «дорогой» звук, а не «пищалки»: плавная атака, экспоненциальное затухание.
 */

/** Impulse response для реверба — затухающий стерео-шум (тёплая комната). */
export function makeReverbIR(ctx: AudioContext, seconds = 1.7, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return ir;
}

/** Короткий буфер белого шума (переиспользуем как источник для шумовых звуков). */
export function makeNoiseBuffer(ctx: AudioContext, seconds = 0.5): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(1, len, rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export interface ToneOpts {
  freq: number;
  type?: OscillatorType;
  t0?: number; // когда начать (сек, абсолютное время ctx)
  freqEnd?: number; // питч-глайд к концу dur
  attack?: number; // c
  decay?: number; // c (экспоненциальное затухание до нуля)
  peak?: number; // пиковая громкость
  filterType?: BiquadFilterType;
  filterFreq?: number;
  filterQ?: number;
}

/** Один тон с мягкой огибающей (атака → экспоненциальное затухание), опц. фильтр и питч-глайд. */
export function tone(ctx: AudioContext, dest: AudioNode, o: ToneOpts): void {
  const t0 = o.t0 ?? ctx.currentTime;
  const attack = o.attack ?? 0.006;
  const decay = o.decay ?? 0.18;
  const peak = o.peak ?? 0.25;
  const end = t0 + attack + decay;

  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.freqEnd) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + attack + decay * 0.8);
  }

  let node: AudioNode = osc;
  if (o.filterType) {
    const f = ctx.createBiquadFilter();
    f.type = o.filterType;
    f.frequency.value = o.filterFreq ?? 1000;
    if (o.filterQ) f.Q.value = o.filterQ;
    osc.connect(f);
    node = f;
  }

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  node.connect(g);
  g.connect(dest);

  osc.start(t0);
  osc.stop(end + 0.03);
}

export interface NoiseOpts {
  buffer: AudioBuffer;
  t0?: number;
  attack?: number;
  decay?: number;
  peak?: number;
  filterType?: BiquadFilterType;
  filterFreq?: number;
  filterQ?: number;
}

/** Шумовой «всплеск» через фильтр с мягкой огибающей (контактный «тук»/свуш). */
export function noiseBurst(ctx: AudioContext, dest: AudioNode, o: NoiseOpts): void {
  const t0 = o.t0 ?? ctx.currentTime;
  const attack = o.attack ?? 0.003;
  const decay = o.decay ?? 0.08;
  const peak = o.peak ?? 0.15;
  const end = t0 + attack + decay;

  const src = ctx.createBufferSource();
  src.buffer = o.buffer;

  let node: AudioNode = src;
  if (o.filterType) {
    const f = ctx.createBiquadFilter();
    f.type = o.filterType;
    f.frequency.value = o.filterFreq ?? 900;
    if (o.filterQ) f.Q.value = o.filterQ;
    src.connect(f);
    node = f;
  }

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  node.connect(g);
  g.connect(dest);

  src.start(t0);
  src.stop(end + 0.03);
}
