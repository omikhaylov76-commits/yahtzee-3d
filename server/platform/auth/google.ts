/**
 * Google-провайдер входа (2.3.b): Authorization Code flow через google-auth-library. Подлинность
 * входа гарантируется проверкой id-token (подпись Google + `aud` = наш clientId) — клиент НЕ может
 * подсунуть чужой/поддельный токен. Секрет приходит из env (композиционный корень), не хранится тут.
 */
import { OAuth2Client } from 'google-auth-library';
import type { AuthProvider, AuthUserInfo } from './AuthProvider';

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createGoogleAuthProvider(cfg: GoogleAuthConfig): AuthProvider {
  const client = new OAuth2Client(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  return {
    id: 'google',
    getAuthUrl(state) {
      return client.generateAuthUrl({
        access_type: 'online',
        scope: ['openid', 'email', 'profile'],
        state,
        prompt: 'select_account',
      });
    },
    async exchangeCode(code) {
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw new Error('Google: no id_token in token response');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: cfg.clientId,
      });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email) throw new Error('Google: incomplete profile (no sub/email)');
      return {
        provider: 'google',
        externalId: p.sub,
        email: p.email,
        displayName: p.name ?? p.email,
        avatarUrl: p.picture ?? null,
      } satisfies AuthUserInfo;
    },
  };
}
