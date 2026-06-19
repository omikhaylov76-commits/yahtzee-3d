/**
 * Тесты нормализации имени (2.2.b): NFC-склейка, вырезание невидимых/директивных символов, анти-XSS,
 * схлоп пробелов, ограничение длины, сохранение видимого (эмодзи/не-латиница). Дедуп в комнате —
 * отдельно (seating.test.ts), он серверный. «Грязные» символы собираем из КОДПОЙНТОВ через `cp(...)`,
 * чтобы в исходнике теста не было литеральных невидимок (их не отличить от пустой строки глазами).
 */
import { describe, it, expect } from 'vitest';
import { normalizeName, MAX_NAME_LEN } from './names';

/** Строка из кодпойнтов — наглядная и точная замена литеральным невидимым символам. */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

describe('normalizeName', () => {
  it('обычное имя не меняет', () => {
    expect(normalizeName('Alice')).toBe('Alice');
  });

  it('схлопывает пробелы и обрезает края', () => {
    expect(normalizeName('  Bob   Lee  ')).toBe('Bob Lee');
    expect(normalizeName('\tBob\nLee ')).toBe('Bob Lee');
  });

  it('пусто / undefined / только пробелы → пустая строка', () => {
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName('')).toBe('');
    expect(normalizeName('    ')).toBe('');
    expect(normalizeName(cp(0x00a0, 0x3000))).toBe(''); // nbsp + ideographic space
  });

  it('вырезает управляющие C0/C1 и DEL', () => {
    expect(normalizeName('A' + cp(0x00, 0x07) + 'B')).toBe('AB');
    expect(normalizeName('A' + cp(0x7f, 0x85) + 'B')).toBe('AB'); // DEL + C1 NEL
  });

  it('вырезает zero-width семью, word joiner и BOM', () => {
    const dirty =
      'A' +
      cp(0x200b) +
      'B' +
      cp(0x200c) +
      'C' +
      cp(0x200d) +
      'D' +
      cp(0x2060) +
      'E' +
      cp(0xfeff) +
      'F';
    expect(normalizeName(dirty)).toBe('ABCDEF');
  });

  it('вырезает bidi-директивы (LRM/RLM, embedding/override, isolate)', () => {
    expect(normalizeName('A' + cp(0x200e) + 'B' + cp(0x200f) + 'C')).toBe('ABC');
    expect(normalizeName(cp(0x202e) + 'evil' + cp(0x202c))).toBe('evil');
    expect(normalizeName(cp(0x2066) + 'X' + cp(0x2069))).toBe('X');
  });

  it('вырезает soft hyphen', () => {
    expect(normalizeName('A' + cp(0x00ad) + 'B')).toBe('AB');
  });

  it('вырезает прочие невидимые (Hangul fillers, Mongolian vowel sep, Braille blank)', () => {
    expect(normalizeName('A' + cp(0x115f, 0x1160, 0x3164, 0x180e, 0x2800) + 'B')).toBe('AB');
    expect(normalizeName(cp(0x3164, 0x2800))).toBe(''); // имя из одних невидимок → пусто
  });

  it('вырезает угловые скобки (анти-XSS)', () => {
    expect(normalizeName('<script>')).toBe('script');
    expect(normalizeName('a<b>c')).toBe('abc');
  });

  it('выравнивает Unicode в NFC (e + combining acute → é, одна графема)', () => {
    const res = normalizeName('e' + cp(0x0301)); // e + COMBINING ACUTE ACCENT
    expect(res).toBe(cp(0x00e9)); // é
    expect([...res]).toHaveLength(1);
  });

  it('сохраняет не-латиницу и одиночные эмодзи', () => {
    expect(normalizeName('Саша')).toBe('Саша');
    expect(normalizeName(cp(0x1f600) + ' Bob')).toBe(cp(0x1f600) + ' Bob');
  });

  it('ограничивает длину по кодпойнтам', () => {
    const long = 'a'.repeat(MAX_NAME_LEN + 12);
    expect([...normalizeName(long)]).toHaveLength(MAX_NAME_LEN);
  });

  it('идемпотентна: повторный прогон ничего не меняет', () => {
    const once = normalizeName('  <b>' + cp(0x200b) + 'Alice' + cp(0x202e) + '  ');
    expect(normalizeName(once)).toBe(once);
  });
});
