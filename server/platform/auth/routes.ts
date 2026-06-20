/**
 * Маршруты входа через провайдера (2.3.b). `/auth/<provider>/start` — отправляет к провайдеру с `state`
 * (CSRF); `/callback` — сверяет state, обменивает код, заводит/находит аккаунт. State хранится
 * server-side с TTL (single-process; рестарт во время входа → повтор, приемлемо до 2.3.c).
 * Постоянная сессия (cookie/jose) — 2.3.c; пока callback отдаёт временную страницу-подтверждение.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthProvider } from './AuthProvider';
import { findOrCreateUser } from './users';

const STATE_TTL_MS = 10 * 60_000;

/** Экранирование пользовательского текста в HTML (имя из профиля Google может содержать `<>` — XSS). */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export function registerAuth(app: FastifyInstance, provider: AuthProvider): void {
  // state → expiresAt (CSRF; одноразовый, с TTL). Истёкшие подметаем лениво на каждом start.
  const states = new Map<string, number>();

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
      // Сессия (постоянная залогиненность) — 2.3.c. Пока временная страница-подтверждение.
      return reply.type('text/html').send(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">
         <h2>Вход выполнен ✓</h2><p>Вы вошли как <b>${escapeHtml(user.displayName)}</b>.</p>
         <p style="color:#888">Постоянная сессия появится в 2.3.c. (user id: ${user.id})</p></body>`,
      );
    } catch (e) {
      req.log.error(e, 'auth callback failed');
      return reply.code(400).send({ error: 'authentication failed' });
    }
  });
}
