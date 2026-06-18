/**
 * Локальное хранилище персонального соло-рекорда (2.L.b, ADR-0014): лучший итог соло-партии
 * между сессиями — без аккаунта и без сети. Отдельный ключ от сохранения партии.
 *
 * Это ЛОКАЛЬНЫЙ концерн: сетевая статистика/лидерборд (ADR-0008) к нему НЕ относятся. Как и
 * сохранение партии (GameStorage), рекорд обслуживает только локальный режим — сетевой
 * NetworkTransport localStorage не использует (правило закрепляется в 2.1.c).
 *
 * Версионированный ключ + конверт с версией: смена формата не ломает игру (load -> null).
 * Все операции в try/catch (приватный режим/квота не должны ронять игру). Объект Storage
 * инъекцируется (по умолчанию globalThis.localStorage) — удобно для тестов.
 */
export const SOLO_RECORD_VERSION = 1;
export const SOLO_RECORD_KEY = `yahtzee3d:v${SOLO_RECORD_VERSION}:solo-record`;

interface Envelope {
  version: number;
  best: number;
}

export interface SoloRecordResult {
  /** Текущий рекорд после учёта итога. */
  best: number;
  /** Был ли этот итог новым рекордом (или самым первым результатом). */
  isRecord: boolean;
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class SoloRecordStorage {
  private readonly storage: Storage | null;

  constructor(
    storage: Storage | null = defaultStorage(),
    private readonly key: string = SOLO_RECORD_KEY,
  ) {
    this.storage = storage;
  }

  /** Текущий рекорд или null (нет/повреждено/иная версия). */
  load(): number | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const envelope = JSON.parse(raw) as Partial<Envelope>;
      if (!envelope || envelope.version !== SOLO_RECORD_VERSION) return null;
      if (typeof envelope.best !== 'number' || !Number.isFinite(envelope.best)) return null;
      return envelope.best;
    } catch {
      return null;
    }
  }

  /**
   * Учесть итог завершённой соло-партии. Сохраняет ТОЛЬКО если итог строго лучше прежнего
   * (или рекорда ещё не было). Идемпотентно: повтор с тем же/меньшим итогом ничего не меняет
   * (перезагрузка на экране итогов не «накручивает» рекорд).
   */
  record(total: number): SoloRecordResult {
    const prev = this.load();
    if (prev === null || total > prev) {
      this.save(total);
      return { best: total, isRecord: true };
    }
    return { best: prev, isRecord: false };
  }

  private save(best: number): void {
    if (!this.storage) return;
    try {
      const envelope: Envelope = { version: SOLO_RECORD_VERSION, best };
      this.storage.setItem(this.key, JSON.stringify(envelope));
    } catch {
      /* квота/приватный режим — тихо игнорируем */
    }
  }
}

/** Дефолтный экземпляр приложения (localStorage). */
export const soloRecordStorage = new SoloRecordStorage();
