/**
 * Тесты кодов комнат (2.2.a-1): длина/алфавит/энтропия, нормализация ввода (Crockford), валидация,
 * генерация уникального кода с обходом коллизий. Чистый модуль — без сокетов.
 */
import { describe, it, expect } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  generateCode,
  generateUniqueCode,
  isValidCode,
  normalizeCode,
} from './codes';

describe('generateCode', () => {
  it('даёт код нужной длины только из символов алфавита', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect([...code].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    }
  });

  it('алфавит — Crockford base32 (32 символа, без I/L/O/U): длина 6 => 30 бит', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(Math.log2(CODE_ALPHABET.length ** CODE_LENGTH)).toBe(30);
  });

  it('коды не вырождены (за серию встречается >1 разного значения)', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateCode()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('normalizeCode', () => {
  it('верхний регистр и Crockford-декод похожих символов (O→0, I/L→1)', () => {
    expect(normalizeCode('abc234')).toBe('ABC234');
    expect(normalizeCode('oil')).toBe('011'); // O→0, I→1, L→1
  });

  it('отбрасывает пробелы, дефисы и прочий мусор', () => {
    expect(normalizeCode('AB C-23 4')).toBe('ABC234');
    expect(normalizeCode('  k7q9zp  ')).toBe('K7Q9ZP');
  });

  it('пустой/undefined → пустая строка', () => {
    expect(normalizeCode(undefined)).toBe('');
    expect(normalizeCode('')).toBe('');
  });
});

describe('isValidCode', () => {
  it('валиден ровно при точной длине и символах алфавита', () => {
    expect(isValidCode(generateCode())).toBe(true);
    expect(isValidCode('ABC234')).toBe(true);
  });

  it('невалиден при неверной длине или чужих символах', () => {
    expect(isValidCode('ABC23')).toBe(false); // короче
    expect(isValidCode('ABC2345')).toBe(false); // длиннее
    expect(isValidCode('ABCIL2')).toBe(false); // I/L не в алфавите
    expect(isValidCode('')).toBe(false);
  });
});

describe('generateUniqueCode', () => {
  it('обходит занятые коды', () => {
    const taken = new Set<string>();
    // Первый сгенерированный код объявляем занятым один раз, проверяем что вернётся другой.
    const first = generateCode();
    taken.add(first);
    const code = generateUniqueCode((c) => taken.has(c));
    expect(taken.has(code)).toBe(false);
    expect(isValidCode(code)).toBe(true);
  });

  it('бросает, если за лимит попыток всё занято (перегрузка)', () => {
    expect(() => generateUniqueCode(() => true, 5)).toThrow();
  });
});
