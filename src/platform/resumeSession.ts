/**
 * Resume-on-reload (2.4.c-3-3): храним секрет реклейма места в sessionStorage (ПО ВКЛАДКЕ — переживает
 * F5/перезагрузку, но не закрытие вкладки), чтобы при перезагрузке вернуться в ИДУЩУЮ сетевую партию по
 * `reconnectToken` (2.4.c-1), а не делать fresh-join. Храним лишь нужное для reclaim: тип входа (join
 * приватной комнаты / joinOpen открытого стола), id комнаты, секретный токен и имя. Парс/валидация —
 * чистые (тестируемые в node); сам sessionStorage обёрнут в try/catch (приватный режим/недоступность).
 */
import type { OnlineIntent } from '../transport/NetworkTransport';

const KEY = 'yz.resume.v1';

export interface ResumeInfo {
  type: 'join' | 'joinOpen';
  roomId: string;
  token: string;
  name?: string;
}

/** Разобрать сырое значение из sessionStorage в ResumeInfo (или null, если пусто/мусор/чужой формат). Чистая. */
export function parseResume(raw: string | null): ResumeInfo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ResumeInfo>;
    if (
      (v.type === 'join' || v.type === 'joinOpen') &&
      typeof v.roomId === 'string' &&
      v.roomId !== '' &&
      typeof v.token === 'string' &&
      v.token !== ''
    ) {
      return {
        type: v.type,
        roomId: v.roomId,
        token: v.token,
        ...(typeof v.name === 'string' && v.name !== '' ? { name: v.name } : {}),
      };
    }
  } catch {
    // не-JSON / повреждено — игнорируем
  }
  return null;
}

/** ResumeInfo → намерение входа для goOnline: приватная комната по коду или открытый/дежурный стол по id. */
export function resumeToIntent(info: ResumeInfo): OnlineIntent {
  return info.type === 'joinOpen'
    ? { type: 'joinOpen', tableId: info.roomId, ...(info.name ? { name: info.name } : {}) }
    : { type: 'join', code: info.roomId, ...(info.name ? { name: info.name } : {}) };
}

export function saveResume(info: ResumeInfo): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    // sessionStorage недоступен (приватный режим) — резюм просто не сработает, игру не роняем
  }
}

export function loadResume(): ResumeInfo | null {
  try {
    return parseResume(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function clearResume(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
