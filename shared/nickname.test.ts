import { describe, it, expect } from 'vitest';
import { isReservedNickname, isValidNickname, nicknameKey, MIN_NICKNAME_LEN } from './nickname';

describe('nicknameKey — свёртка для уникальности', () => {
  it('без учёта регистра: Alex == alex == ALEX', () => {
    expect(nicknameKey('Alex')).toBe('alex');
    expect(nicknameKey('ALEX')).toBe('alex');
    expect(nicknameKey('alex')).toBe('alex');
  });

  it('локаль-инвариантна (toLowerCase, не toLocaleLowerCase): ASCII I → i всегда', () => {
    expect(nicknameKey('ALI')).toBe('ali');
    // Детерминизм между процессами/машинами: один ввод → один ключ.
    expect(nicknameKey('İstanbul')).toBe(nicknameKey('İstanbul'));
  });

  it('наследует чистку имени: схлоп пробелов и обрезка краёв', () => {
    expect(nicknameKey('  Cool   Player  ')).toBe('cool player');
  });

  it('пустой / только пробелы / undefined → пустой ключ', () => {
    expect(nicknameKey('   ')).toBe('');
    expect(nicknameKey(undefined)).toBe('');
  });
});

describe('isValidNickname — валидность ввода', () => {
  it('нормальный ник валиден', () => {
    expect(isValidNickname('Neo')).toBe(true);
  });

  it('пустой / из невидимок — невалиден', () => {
    expect(isValidNickname('')).toBe(false);
    expect(isValidNickname('   ')).toBe(false);
    expect(isValidNickname('​​')).toBe(false); // zero-width режется normalizeName
  });

  it(`короче ${MIN_NICKNAME_LEN} символов — невалиден`, () => {
    expect(isValidNickname('a')).toBe(false);
  });

  it('XSS-символы вырезаются, остаток оценивается', () => {
    expect(isValidNickname('<script>ok')).toBe(true); // '<','>' срезаны → 'scriptok'
    expect(nicknameKey('<script>ok')).toBe('scriptok');
  });
});

describe('isReservedNickname — системные имена (по ключу)', () => {
  it('«Deleted player» зарезервирован в любом регистре', () => {
    expect(isReservedNickname(nicknameKey('Deleted player'))).toBe(true);
    expect(isReservedNickname(nicknameKey('DELETED PLAYER'))).toBe(true);
  });

  it('шаблон «Player N» зарезервирован', () => {
    expect(isReservedNickname(nicknameKey('Player 2'))).toBe(true);
    expect(isReservedNickname(nicknameKey('player 10'))).toBe(true);
  });

  it('обычные ники не зарезервированы', () => {
    expect(isReservedNickname(nicknameKey('Player'))).toBe(false); // без числа
    expect(isReservedNickname(nicknameKey('Alex'))).toBe(false);
    expect(isReservedNickname(nicknameKey('Player One'))).toBe(false);
  });
});
