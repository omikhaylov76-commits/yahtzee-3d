/**
 * Криптостойкий источник случайности для сетевого режима (ADR-0012). Значения костей сетевых
 * партий генерирует СЕРВЕР отсюда (а не `mulberry32(seed)` ядра, который предсказуем по выходам).
 * Локальный режим продолжает считать кости детерминированно через `core/rng.ts` — это разные пути.
 */
import { randomInt } from 'node:crypto';
import type { DieValue } from '../../src/core';

/** `count` значений костей 1..6 из CSPRNG. По выходам следующий бросок не предсказать. */
export function rollDiceValues(count: number): DieValue[] {
  // randomInt(min, max) — верхняя граница исключается, поэтому [1, 7) => 1..6.
  return Array.from({ length: count }, () => randomInt(1, 7) as DieValue);
}

/**
 * Случайный seed партии. В сетевом пути кости всегда инъецируются (CSPRNG выше), поэтому ядровый
 * `rng` не используется — но дефолт `seed=1` в сетевом режиме ЗАПРЕЩЁН (ADR-0012), даём явный.
 */
export function randomSeed(): number {
  return randomInt(0, 2 ** 31);
}
