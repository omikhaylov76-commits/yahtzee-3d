import type { Category } from '../../core';

/**
 * Прототип F8: пип-глиф у каждой категории, в плоском минимализме Auros.
 * - Ones–Sixes: грань кубика (1–6 точек).
 * - Three/Four of a kind: кластер / квадрат одинаковых точек.
 * - Full house: 3 сверху + 2 снизу.
 * - Стриты: возрастающие полоски (малый 3, большой 4) — «по возрастанию».
 * - Yahtzee: грань-5 в лиловом акценте.
 * - Chance: контур кубика с россыпью точек — «любой бросок».
 * Всё на сетке 0..12.
 */

const A = 3;
const B = 6;
const C = 9;
const FACE: Record<number, [number, number][]> = {
  1: [[B, B]],
  2: [
    [A, A],
    [C, C],
  ],
  3: [
    [A, A],
    [B, B],
    [C, C],
  ],
  4: [
    [A, A],
    [C, A],
    [A, C],
    [C, C],
  ],
  5: [
    [A, A],
    [C, A],
    [B, B],
    [A, C],
    [C, C],
  ],
  6: [
    [A, A],
    [A, B],
    [A, C],
    [C, A],
    [C, B],
    [C, C],
  ],
};

interface Glyph {
  pips?: [number, number][];
  bars?: { w: number; items: { x: number; h: number }[] }; // возрастающие полоски (стриты)
  die?: boolean; // контур кубика + россыпь (Chance)
  accent?: boolean; // лиловый (Yahtzee)
}

const GLYPHS: Record<Category, Glyph> = {
  ones: { pips: FACE[1] },
  twos: { pips: FACE[2] },
  threes: { pips: FACE[3] },
  fours: { pips: FACE[4] },
  fives: { pips: FACE[5] },
  sixes: { pips: FACE[6] },
  // Тройка — плотный кластер из 3.
  threeKind: {
    pips: [
      [6, 4.6],
      [4.6, 7.2],
      [7.4, 7.2],
    ],
  },
  // Каре — квадрат из 4.
  fourKind: {
    pips: [
      [A, A],
      [C, A],
      [A, C],
      [C, C],
    ],
  },
  // Фул-хаус — 3 сверху + 2 снизу.
  fullHouse: {
    pips: [
      [A, A],
      [B, A],
      [C, A],
      [4.5, C],
      [7.5, C],
    ],
  },
  // Малый стрит — 3 возрастающие полоски (крупнее).
  smallStraight: {
    bars: {
      w: 2.4,
      items: [
        { x: 1.0, h: 4.5 },
        { x: 4.8, h: 7 },
        { x: 8.6, h: 9.5 },
      ],
    },
  },
  // Большой стрит — 4 возрастающие полоски.
  largeStraight: {
    bars: {
      w: 2.0,
      items: [
        { x: 0.5, h: 3.5 },
        { x: 3.5, h: 5.5 },
        { x: 6.5, h: 7.5 },
        { x: 9.5, h: 9.5 },
      ],
    },
  },
  // Yahtzee — грань-5, лиловый акцент.
  yahtzee: { pips: FACE[5], accent: true },
  // Chance — контур кубика + россыпь («любой бросок»).
  chance: { die: true },
};

const BASE = 11; // нижняя линия полосок
const SCATTER: [number, number][] = [
  [4.2, 4.4],
  [7.4, 5.8],
  [5.4, 8.2],
];

export function CategoryGlyph({ category }: { category: Category }) {
  const g = GLYPHS[category];
  return (
    <svg
      className={`cat-glyph${g.accent ? ' cat-glyph--accent' : ''}`}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      {g.die && (
        <>
          <rect className="cat-glyph__die" x="1.6" y="1.6" width="8.8" height="8.8" rx="2.2" />
          {SCATTER.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="0.85" />
          ))}
        </>
      )}
      {g.bars?.items.map((b, i) => (
        <rect
          key={i}
          className="cat-glyph__bar"
          x={b.x}
          y={BASE - b.h}
          width={g.bars!.w}
          height={b.h}
          rx="0.4"
        />
      ))}
      {g.pips?.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.15" />
      ))}
    </svg>
  );
}
