import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useGameStore } from '../../state/gameStore';
import { prefersReducedMotion } from '../capabilities';

/**
 * F6.2 — сдержанное празднование (слой сочности). Слушает доменные события ядра
 * (`combo:yahtzee`, `game:over`) и рисует короткий всплеск частиц + мягкий glow.
 * В правила/счёт не лезет; reduced-motion → только тихая вспышка без частиц.
 * Оверлей `pointer-events:none` — не перехватывает клики.
 */

const PARTICLE_COUNT = 18;
/** Длительность вспышки, мс. Должна быть ≥ длительности spark/glow в theme.css. */
const BURST_MS = 1200;
/** Под reduced-motion анимаций нет (глобальный guard их гасит): держим статичный glow
 *  коротко — тихая вспышка, а не долгий засвет на экране. */
const REDUCED_BURST_MS = 450;

interface Burst {
  key: number;
  kind: 'yahtzee' | 'win';
}

/** Детерминизм здесь не нужен — частицы чисто косметические (RNG ядра не задействуем). */
function sparkStyle(i: number): CSSProperties {
  const angle = (360 / PARTICLE_COUNT) * i + (Math.random() * 18 - 9);
  const dist = 120 + Math.random() * 130;
  const rad = (angle * Math.PI) / 180;
  return {
    '--tx': `${Math.cos(rad) * dist}px`,
    '--ty': `${Math.sin(rad) * dist}px`,
    '--delay': `${Math.round(Math.random() * 70)}ms`,
    // Чередуем cyan/lilac, чтобы всплеск был «дорогой», но в палитре Auros.
    '--spark': i % 2 === 0 ? 'var(--cyan, #4fd9c6)' : '#c9a8ff',
  } as CSSProperties;
}

export function Celebration() {
  const events = useGameStore((s) => s.events);
  const reduced = prefersReducedMotion();
  const [burst, setBurst] = useState<Burst | null>(null);
  const nonce = useRef(0);

  useEffect(() => {
    // Победа приоритетнее одиночного Yahtzee, если оба пришли в одном батче.
    const win = events.find((e) => e.type === 'game:over');
    const yz = events.find((e) => e.type === 'combo:yahtzee');
    const kind: Burst['kind'] | null = win ? 'win' : yz ? 'yahtzee' : null;
    if (!kind) return;
    nonce.current += 1;
    const key = nonce.current;
    setBurst({ key, kind });
    const life = reduced ? REDUCED_BURST_MS : BURST_MS;
    const t = setTimeout(() => setBurst((b) => (b?.key === key ? null : b)), life);
    return () => clearTimeout(t);
  }, [events, reduced]);

  if (!burst) return null;

  return (
    // key=nonce перезапускает анимацию при идущих подряд Yahtzee.
    <div
      className={`celebrate${reduced ? ' is-reduced' : ''}`}
      data-kind={burst.kind}
      key={burst.key}
      aria-hidden="true"
    >
      <div className="celebrate__glow" />
      {!reduced &&
        Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
          <span key={i} className="celebrate__spark" style={sparkStyle(i)} />
        ))}
    </div>
  );
}
