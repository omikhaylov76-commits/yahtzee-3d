/**
 * Состояние входа в аккаунт (2.3.c-2): кто залогинен (из `/auth/me` по cookie сессии), вход/выход.
 * Cookie сессии — httpOnly (JS её не читает), поэтому статус узнаём запросом к серверу.
 */
import { create } from 'zustand';

export interface AuthUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loaded: boolean; // прошёл ли первый `/auth/me` (чтобы не мигать «войти» до ответа)
  fetchMe: () => Promise<void>;
  logout: () => Promise<void>;
}

// В проде клиент раздаётся тем же сервером (same-origin) → относительные пути; в dev сервер на :3001.
const AUTH_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loaded: false,
  fetchMe: async () => {
    try {
      const r = await fetch(`${AUTH_BASE}/auth/me`, { credentials: 'include' });
      const d = (await r.json()) as { user: AuthUser | null };
      set({ user: d.user ?? null, loaded: true });
    } catch {
      set({ user: null, loaded: true });
    }
  },
  logout: async () => {
    try {
      await fetch(`${AUTH_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      // сеть недоступна — всё равно сбросим локально
    }
    set({ user: null });
  },
}));
