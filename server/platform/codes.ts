/**
 * Коды комнат (2.2.a-1, ADR-0009) — ЧИСТЫЙ модуль (без сокетов), поэтому тестируем (codes.test.ts).
 *
 * Требование ADR-0009: код ≥6 символов из криптослучайного non-ambiguous алфавита (≥~30 бит) +
 * жёсткий rate-limit на подбор (он в realtime.ts — вторая линия; энтропия — первая).
 *
 * Алфавит — Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, без I/L/O/U): 32 символа,
 * длина 6 => 32^6 = 2^30 = ровно 30 бит. Ввод нормализуем по Crockford (O→0, I/L→1, регистр),
 * чтобы человек мог продиктовать/набрать код без путаницы похожих символов.
 */
import { randomInt } from 'node:crypto';

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 6;

/** Один криптослучайный код (без проверки уникальности — это `generateUniqueCode`). */
export function generateCode(length: number = CODE_LENGTH): string {
  let out = '';
  // randomInt(0, n) — верхняя граница исключается => равномерный индекс по алфавиту из CSPRNG.
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return out;
}

/**
 * Уникальный код: генерируем, пока `isTaken` не скажет «свободен». Коллизии при 2^30 редки, но
 * детерминированно не зацикливаемся — после `attempts` неудач бросаем (вызов трактует как перегрузку).
 */
export function generateUniqueCode(isTaken: (code: string) => boolean, attempts = 10): string {
  for (let i = 0; i < attempts; i++) {
    const code = generateCode();
    if (!isTaken(code)) return code;
  }
  throw new Error('could not generate a unique room code');
}

/**
 * Нормализация введённого человеком кода (Crockford-декод): верхний регистр, O→0, I/L→1; всё, что
 * не из алфавита после маппинга (пробелы, дефисы, мусор), отбрасываем. Длину НЕ обрезаем — это
 * проверит `isValidCode` (слишком длинный/короткий => невалидный => комната не найдётся).
 */
export function normalizeCode(raw: string | undefined): string {
  return [...(raw ?? '')]
    .map((ch) => ch.toUpperCase())
    .map((ch) => (ch === 'O' ? '0' : ch === 'I' || ch === 'L' ? '1' : ch))
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('');
}

/** Валиден ли УЖЕ нормализованный код (точная длина + только символы алфавита). */
export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}
