/**
 * Сессионные токены (2.3.c): подписанный JWT (jose, HS256) для httpOnly cookie. Payload — `userId`
 * (sub) + `tokenVersion`. Отзыв ВСЕХ сессий пользователя — инкрементом `tokenVersion` в `users`
 * (сверяется в `/auth/me`). Секрет — `SESSION_SECRET` из env (не в коде).
 */
import { SignJWT, jwtVerify } from 'jose';

const SESSION_TTL = '7d';
export const SESSION_COOKIE = 'sid';
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // секунды (для cookie maxAge)

export interface SessionPayload {
  userId: string;
  tokenVersion: number;
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(s);
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ tokenVersion: p.tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.userId)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.tokenVersion !== 'number') return null;
    return { userId: payload.sub, tokenVersion: payload.tokenVersion };
  } catch {
    return null; // истёк/битый/подделан — не залогинен
  }
}
