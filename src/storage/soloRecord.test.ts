import { describe, it, expect } from 'vitest';
import { SoloRecordStorage, SOLO_RECORD_KEY, SOLO_RECORD_VERSION } from './soloRecordStorage';

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

describe('SoloRecordStorage', () => {
  it('нет ключа -> load = null', () => {
    expect(new SoloRecordStorage(fakeStorage()).load()).toBeNull();
  });

  it('первый результат = рекорд, сохраняется', () => {
    const s = new SoloRecordStorage(fakeStorage());
    expect(s.record(180)).toEqual({ best: 180, isRecord: true });
    expect(s.load()).toBe(180);
  });

  it('бо́льший итог обновляет рекорд', () => {
    const s = new SoloRecordStorage(fakeStorage());
    s.record(180);
    expect(s.record(210)).toEqual({ best: 210, isRecord: true });
    expect(s.load()).toBe(210);
  });

  it('меньший или равный итог НЕ меняет рекорд (идемпотентно)', () => {
    const s = new SoloRecordStorage(fakeStorage());
    s.record(210);
    expect(s.record(200)).toEqual({ best: 210, isRecord: false });
    expect(s.record(210)).toEqual({ best: 210, isRecord: false });
    expect(s.load()).toBe(210);
  });

  it('повреждённый JSON -> load = null', () => {
    const fake = fakeStorage();
    fake.setItem(SOLO_RECORD_KEY, '{не-json');
    expect(new SoloRecordStorage(fake).load()).toBeNull();
  });

  it('иная версия конверта -> load = null', () => {
    const fake = fakeStorage();
    fake.setItem(SOLO_RECORD_KEY, JSON.stringify({ version: SOLO_RECORD_VERSION + 1, best: 250 }));
    expect(new SoloRecordStorage(fake).load()).toBeNull();
  });

  it('best не число -> load = null', () => {
    const fake = fakeStorage();
    fake.setItem(SOLO_RECORD_KEY, JSON.stringify({ version: SOLO_RECORD_VERSION, best: 'x' }));
    expect(new SoloRecordStorage(fake).load()).toBeNull();
  });

  it('недоступный storage (null) -> не падает, load = null', () => {
    const s = new SoloRecordStorage(null);
    expect(() => s.record(300)).not.toThrow();
    expect(s.load()).toBeNull();
  });
});
