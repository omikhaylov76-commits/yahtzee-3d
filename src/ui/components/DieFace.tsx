/** Грань кости-плейсхолдера: точки (pips) на сетке 3×3. 3D-грани придут в F4. */

// Позиции точек по значению (сетка 1..9, построчно).
const PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

export function DieFace({ value, blank = false }: { value: number; blank?: boolean }) {
  const on = blank ? new Set<number>() : new Set(PIPS[value] ?? []);
  return (
    <span className="die-face" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`die-face__cell${on.has(i + 1) ? ' die-face__cell--on' : ''}`} />
      ))}
    </span>
  );
}
