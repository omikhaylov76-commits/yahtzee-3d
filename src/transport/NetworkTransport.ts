/**
 * ЗАГЛУШКА сетевого транспорта — явная точка под будущий сервер (ADR 0003, Веха 2).
 * Сейчас НЕ реализована намеренно: ядро и UI уже работают через интерфейс Transport,
 * поэтому в Вехе 2 здесь появится реальная синхронизация по действиям/seed БЕЗ изменения
 * остального кода.
 */
import type { Transport } from './Transport';

const NOT_IMPLEMENTED = 'NetworkTransport не реализован (заглушка под сеть, Веха 2)';

export class NetworkTransport implements Transport {
  // TODO(Веха 2): подключение к серверу, синхронизация состояния/действий по seed.

  getState(): null {
    throw new Error(NOT_IMPLEMENTED);
  }

  dispatch(): void {
    throw new Error(NOT_IMPLEMENTED);
  }

  reset(): void {
    throw new Error(NOT_IMPLEMENTED);
  }

  subscribe(): () => void {
    throw new Error(NOT_IMPLEMENTED);
  }
}
