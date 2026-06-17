/**
 * Сидируемый ГПСЧ (mulberry32) для бросков костей. Чистый и детерминированный:
 * состояние передаётся явно (in -> out), чтобы reduce оставался чистой функцией.
 * Это нужно для тестов и будущей сети (общий seed -> одинаковые броски, ADR 0004).
 */
import type { DieValue } from './types';

/** Один шаг ГПСЧ: возвращает число в [0,1) и новое состояние. */
export function nextRandom(state: number): { value: number; state: number } {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: a };
}

/** Бросить одну кость (1..6), вернуть значение и новое состояние ГПСЧ. */
export function rollDie(state: number): { value: DieValue; state: number } {
  const { value, state: next } = nextRandom(state);
  const rolled = (((value * 6) | 0) + 1) as DieValue;
  return { value: rolled, state: next };
}
