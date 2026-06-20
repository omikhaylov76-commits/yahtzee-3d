/**
 * Маршруты входа и сессии (2.3.b/c). `/auth/<provider>/start` — к провайдеру с `state` (CSRF);
 * `/callback` — сверяет state, обменивает код, заводит/находит аккаунт, СТАВИТ сессию (httpOnly cookie)
 * и возвращает в приложение. `/auth/me` — кто залогинен (по cookie); `/auth/logout` — выход.
 * State — server-side с TTL (single-process; рестарт во время входа → повтор, приемлемо).
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthProvider } from './AuthProvider';
import { findOrCreateUser, getUserById } from './users';
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from './session';

const STATE_TTL_MS = 10 * 60_000;

export function registerAuth(app: FastifyInstance, provider: AuthProvider): void {
  // state → expiresAt (CSRF; одноразовый, с TTL). Истёкшие подметаем лениво на каждом start.
  const states = new Map<string, number>();
  const isProd = process.env.NODE_ENV === 'production';
  // Куда вернуть после входа: в проде клиент same-origin ('/'), в dev — на Vite-клиент (:5173).
  const postLogin = isProd
    ? '/'
    : (process.env.CLIENT_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173');

  app.get(`/auth/${provider.id}/start`, async (_req, reply) => {
    const now = Date.now();
    for (const [s, exp] of states) if (exp < now) states.delete(s);
    const state = randomBytes(16).toString('hex');
    states.set(state, now + STATE_TTL_MS);
    return reply.redirect(provider.getAuthUrl(state));
  });

  app.get(`/auth/${provider.id}/callback`, async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error) return reply.code(400).send({ error: `provider error: ${error}` });
    if (!code || !state) return reply.code(400).send({ error: 'missing code/state' });

    const exp = states.get(state);
    states.delete(state); // одноразовый — снимаем сразу
    if (!exp || exp < Date.now())
      return reply.code(400).send({ error: 'invalid or expired state' });

    try {
      const info = await provider.exchangeCode(code);
      const user = await findOrCreateUser(info);
      const token = await signSession({ userId: user.id, tokenVersion: user.tokenVersion });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: SESSION_MAX_AGE,
      });
      return reply.redirect(postLogin);
    } catch (e) {
      req.log.error(e, 'auth callback failed');
      return reply.code(400).send({ error: 'authentication failed' });
    }
  });

  // Кто залогинен (по cookie). Сверяем tokenVersion — отозванная сессия → null + чистка cookie.
  app.get('/auth/me', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return { user: null };
    const session = await verifySession(token);
    if (!session) return { user: null };
    const user = await getUserById(session.userId);
    if (!user || user.tokenVersion !== session.tokenVersion) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { user: null };
    }
    return { user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl } };
  });

  // Выход — чистим cookie сессии.
  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
