import { describe, it, expect } from 'vitest';
import { createGame } from '../core';
import { MemoryGameStorage } from './memoryGameStorage';
import { LocalStorageGameStorage, STORAGE_KEY, STORAGE_VERSION } from './localStorageGameStorage';

/** Поддельный Web Storage в памяти — чтобы тестировать localStorage-реализацию в Node. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => {
      m.delete(k);
    },
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

const sampleGame = () => createGame([{ name: 'A' }, { name: 'B' }], 5);

describe('MemoryGameStorage', () => {
  it('save -> load возвращает равную копию, не ту же ссылку', () => {
    const s = new MemoryGameStorage();
    const g = sampleGame();
    s.save(g);
    const loaded = s.load();
    expect(loaded).toEqual(g);
    expect(loaded).not.toBe(g);
  });

  it('clear убирает сохранение', () => {
    const s = new MemoryGameStorage();
    s.save(sampleGame());
    s.clear();
    expect(s.load()).toBeNull();
  });

  it('пусто -> null', () => {
    expect(new MemoryGameStorage().load()).toBeNull();
  });
});

describe('LocalStorageGameStorage', () => {
  it('save -> load round-trip', () => {
    const s = new LocalStorageGameStorage(fakeStorage());
    const g = sampleGame();
    s.save(g);
    expect(s.load()).toEqual(g);
  });

  it('нет ключа -> null', () => {
    expect(new LocalStorageGameStorage(fakeStorage()).load()).toBeNull();
  });

  it('повреждённый JSON -> null', () => {
    const fake = fakeStorage();
    fake.setItem(STORAGE_KEY, '{не-json');
    expect(new LocalStorageGameStorage(fake).load()).toBeNull();
  });

  it('иная версия конверта -> null', () => {
    const fake = fakeStorage();
    fake.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION + 1, state: sampleGame() }),
    );
    expect(new LocalStorageGameStorage(fake).load()).toBeNull();
  });

  it('мусор вместо состояния -> null', () => {
    const fake = fakeStorage();
    fake.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: { foo: 1 } }));
    expect(new LocalStorageGameStorage(fake).load()).toBeNull();
  });

  it('правильная форма, но битые инварианты -> null (защита от краша экрана)', () => {
    const base = sampleGame();
    const cases = [
      { ...base, players: [] }, // нет игроков -> players[current] упадёт
      { ...base, current: 9 }, // индекс вне диапазона
      { ...base, current: -1 },
      { ...base, dice: [{ value: 1, held: false }] }, // не 5 костей
      { ...base, phase: 'paused' }, // невалидная фаза
    ];
    for (const state of cases) {
      const fake = fakeStorage();
      fake.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state }));
      expect(new LocalStorageGameStorage(fake).load()).toBeNull();
    }
  });

  it('валидная партия (соло / phase=over) проходит проверку', () => {
    const solo = createGame([{ name: 'Solo' }], 7);
    const fake = fakeStorage();
    const s = new LocalStorageGameStorage(fake);
    s.save(solo);
    expect(s.load()).toEqual(solo);
  });

  it('clear удаляет ключ', () => {
    const s = new LocalStorageGameStorage(fakeStorage());
    s.save(sampleGame());
    s.clear();
    expect(s.load()).toBeNull();
  });

  it('недоступный storage (null) -> не падает, load = null', () => {
    const s = new LocalStorageGameStorage(null);
    expect(() => s.save(sampleGame())).not.toThrow();
    expect(s.load()).toBeNull();
  });
});
