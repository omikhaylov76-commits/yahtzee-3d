/**
 * Тесты разбора deep-link кода комнаты (2.2.c-2). Чистая `parseRoomCode` — без window; обёртки
 * `roomCodeFromUrl`/`roomInviteUrl` над `window.location` проверяются живьём в браузере.
 */
import { describe, it, expect } from 'vitest';
import { parseRoomCode } from './deepLink';

describe('parseRoomCode', () => {
  it('достаёт код из ?room=', () => {
    expect(parseRoomCode('?room=K7Q9ZP')).toBe('K7Q9ZP');
  });

  it('приводит к верхнему регистру', () => {
    expect(parseRoomCode('?room=k7q9zp')).toBe('K7Q9ZP');
  });

  it('выкидывает мусор и обрезает по длине кода', () => {
    expect(parseRoomCode('?room=k7-q9 zp')).toBe('K7Q9ZP');
    expect(parseRoomCode('?room=ABCDEFGHIJ')).toBe('ABCDEF');
  });

  it('null, если параметра нет / пусто / только мусор', () => {
    expect(parseRoomCode('')).toBeNull();
    expect(parseRoomCode('?x=1')).toBeNull();
    expect(parseRoomCode('?room=')).toBeNull();
    expect(parseRoomCode('?room=%20%20')).toBeNull(); // только пробелы → после чистки пусто
  });

  it('находит room среди других параметров', () => {
    expect(parseRoomCode('?foo=1&room=ABC234&bar=2')).toBe('ABC234');
  });
});
