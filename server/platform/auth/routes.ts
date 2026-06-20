/**
 * Маршруты входа и сессии (2.3.b/c). `/auth/<provider>/start` — к провайдеру с `state` (CSRF);
 * `/callback` — сверяет state, обменивает код, заводит/находит аккаунт, СТАВИТ сессию (httpOnly cookie)
 * и возвращает в приложение. `/auth/me` — кто залогинен (по cookie); `/auth/logout` — выход.
 * State — server-side с TTL (single-process; рестарт во время входа → повтор, приемлемо).
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthProvider } from './AuthProvider';
import { findOrCreateUser, getUserById, setNickname, type PlatformUser } from './users';
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from './session';
import { nicknameBodySchema } from '../../../shared/schemas';
import { getPlayerStats } from '../stats/playerStats';

const STATE_TTL_MS = 10 * 60_000;

/**
 * Текущий залогиненный игрок по cookie сессии (2.3.e-2a) — общий гейт HTTP-эндпоинтов (вынесен из
 * инлайна `/auth/me`). Отозванную/битую сессию чистит (clearCookie). НЕ шлёт ответ: вызывающий решает
 * (200 + `{user:null}` для `/auth/me`; 401 для защищённых). `userId` берём ТОЛЬКО из сессии (ADR-0015 M4).
 */
async function currentUser(req: FastifyRequest, reply: FastifyReply): Promise<PlatformUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user || user.tokenVersion !== session.tokenVersion) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return null;
  }
  return user;
}

// Лёгкий самодельный rate-limit смены ника (2.3.e-2a): окно по userId. Single-process, сброс при
// рестарте — принятый риск пилота (полноценный @fastify/rate-limit — 2.4/backlog).
const NICK_MAX = 10;
const NICK_WINDOW_MS = 5 * 60_000;
const nickHits = new Map<string, number[]>();
function allowNickChange(userId: string): boolean {
  const now = Date.now();
  const hits = (nickHits.get(userId) ?? []).filter((t) => now - t < NICK_WINDOW_MS);
  if (hits.length >= NICK_MAX) {
    nickHits.set(userId, hits);
    return false;
  }
  hits.push(now);
  nickHits.set(userId, hits);
  return true;
}

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

  // Кто залогинен (по cookie). Через общий currentUser (сверка tokenVersion + чистка отозванной cookie).
  app.get('/auth/me', async (req, reply) => {
    const user = await currentUser(req, reply);
    return {
      user: user
        ? {
            id: user.id,
            displayName: user.displayName,
            nickname: user.nickname,
            avatarUrl: user.avatarUrl,
          }
        : null,
    };
  });

  // Сменить игровой ник (2.3.e-2a, ADR-0015). userId — из сессии; тело — zod; валидация/уникальность —
  // в setNickname. Ответы: 200 {nickname} / 400 invalid|reserved / 409 taken / 401 / 429 (rate-limit).
  app.post('/auth/nickname', async (req, reply) => {
    const user = await currentUser(req, reply);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (!allowNickChange(user.id)) return reply.code(429).send({ error: 'too_many_requests' });
    const parsed = nicknameBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const result = await setNickname(user.id, parsed.data.nickname);
    if (!result.ok) {
      return reply.code(result.reason === 'taken' ? 409 : 400).send({ error: result.reason });
    }
    return { nickname: result.nickname };
  });

  // Личная статистика залогиненного (2.3.e-4): агрегат по его match_players. userId — ТОЛЬКО из сессии.
  app.get('/auth/stats', async (req, reply) => {
    const user = await currentUser(req, reply);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return getPlayerStats(user.id);
  });

  // Выход — чистим cookie сессии.
  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
