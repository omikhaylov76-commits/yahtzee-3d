import { describe, it, expect } from 'vitest';
import type { DieValue } from '../core';
import { valuesDiffer } from './diceDiff';

const v = (...xs: number[]) => xs as DieValue[];

describe('valuesDiffer (триггер приземления 3D, 2.1.e-1)', () => {
  it('ничего не изменилось → false', () => {
    expect(valuesDiffer(v(1, 2, 3, 4, 5), v(1, 2, 3, 4, 5))).toBe(false);
  });

  it('одна кость изменилась → true', () => {
    expect(valuesDiffer(v(1, 1, 1, 1, 1), v(1, 1, 6, 1, 1))).toBe(true);
  });

  it('held-кости те же, перекинутые изменились → true', () => {
    // Бросок с held на индексах 0 и 3 (значения 4 и 4 сохранились); 1/2/4 — новые.
    expect(valuesDiffer(v(4, 1, 1, 4, 1), v(4, 6, 2, 4, 5))).toBe(true);
  });

  it('reset хода (все → 1) → true', () => {
    expect(valuesDiffer(v(6, 3, 5, 2, 4), v(1, 1, 1, 1, 1))).toBe(true);
  });

  it('разная длина, совпало в пределах минимума → false (safety)', () => {
    expect(valuesDiffer(v(1, 2, 3), v(1, 2, 3, 4, 5))).toBe(false);
  });

  it('разная длина, расхождение в пределах минимума → true', () => {
    expect(valuesDiffer(v(1, 9, 3), v(1, 2, 3, 4, 5))).toBe(true);
  });

  it('перекат В ТО ЖЕ значение у одной кости не виден, но соседняя изменившаяся даёт true', () => {
    // Кость 0: 3→3 (невидимо для diff), кости 1..4 изменились → суммарно true. Десинхрона нет:
    // presim, запущенный по этому true, докручивает ВСЕ неудержанные, включая кость 0.
    expect(valuesDiffer(v(3, 1, 1, 1, 1), v(3, 6, 2, 5, 4))).toBe(true);
  });

  it('все кости «перекатились» в свои же значения → false (грани уже верны, presim не нужен)', () => {
    // Корнер-кейс: ни одно значение не изменилось → diff молчит. Это корректно — рассинхрона нет
    // (грани и так показывают эти значения); анимацию (если она вообще нужна) дал бы событийный путь.
    expect(valuesDiffer(v(2, 3, 4, 5, 6), v(2, 3, 4, 5, 6))).toBe(false);
  });
});
