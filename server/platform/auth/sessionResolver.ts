/**
 * Опознание залогиненного игрока по cookie сессии в рукопожатии Socket.IO (2.3.c-3). Связывает
 * вход (2.3.b/c) с сетевой игрой: realtime получает эту функцию инъекцией (платформа остаётся
 * игро-НЕзависимой, БД-слой грузится лишь когда вход включён). Гость / битая сессия → null.
 */
import { SESSION_COOKIE, verifySession } from './session';
import { getUserById } from './users';

export interface SessionUser {
  userId: string;
  displayName: string;
  /** Игровой ник (ADR-0015): null = ещё не выбран. В игре/комнате игрок выступает под ником (2.3.e-2b). */
  nickname: string | null;
}

/** Достать значение cookie по имени из сырого заголовка `Cookie` (socket.handshake не парсит его). */
function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export async function resolveSessionUser(
  cookieHeader: string | undefined,
): Promise<SessionUser | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user || user.tokenVersion !== session.tokenVersion) return null; // отозвана/удалён
  return { userId: user.id, displayName: user.displayName, nickname: user.nickname };
}
