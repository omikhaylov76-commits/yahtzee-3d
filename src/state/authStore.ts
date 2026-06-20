/**
 * Состояние входа в аккаунт (2.3.c-2): кто залогинен (из `/auth/me` по cookie сессии), вход/выход.
 * Cookie сессии — httpOnly (JS её не читает), поэтому статус узнаём запросом к серверу.
 */
import { create } from 'zustand';

export interface AuthUser {
  id: string;
  displayName: string;
  /** Игровой ник (ADR-0015): null = ещё не выбран (онбординг). Показывается в игре/лидерборде. */
  nickname: string | null;
  avatarUrl: string | null;
}

/** Причина отказа смены ника (2.3.e-3) — для текста в UI. */
export type NickError = 'invalid' | 'reserved' | 'taken' | 'rate' | 'auth' | 'net';

interface AuthState {
  user: AuthUser | null;
  loaded: boolean; // прошёл ли первый `/auth/me` (чтобы не мигать «войти» до ответа)
  fetchMe: () => Promise<void>;
  /** Задать/сменить игровой ник (2.3.e-3). Истина — сервер: вернёт reason при invalid/reserved/taken. */
  setNickname: (raw: string) => Promise<{ ok: true } | { ok: false; reason: NickError }>;
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
  setNickname: async (raw) => {
    try {
      const r = await fetch(`${AUTH_BASE}/auth/nickname`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nickname: raw }),
      });
      if (r.ok) {
        const d = (await r.json()) as { nickname: string };
        set((s) => (s.user ? { user: { ...s.user, nickname: d.nickname } } : {}));
        return { ok: true };
      }
      if (r.status === 409) return { ok: false, reason: 'taken' };
      if (r.status === 429) return { ok: false, reason: 'rate' };
      if (r.status === 401) return { ok: false, reason: 'auth' };
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: d.error === 'reserved' ? 'reserved' : 'invalid' };
    } catch {
      return { ok: false, reason: 'net' };
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
