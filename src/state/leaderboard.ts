/**
 * Лидерборд (2.4.a-2, ADR-0018). Лёгкий ХУК: одноразовый `GET /leaderboard` при открытии экрана +
 * ручной refresh (рейтинг меняется медленно — поллинг не нужен, в отличие от списка столов). В dev —
 * через vite-proxy на :3001; в проде same-origin. Состояние держит хук, не глобальный стор.
 */
import { useCallback, useEffect, useState } from 'react';
import type { LeaderboardRow } from '../../shared/protocol';

export type LeaderboardStatus = 'loading' | 'ready' | 'error';

export interface LeaderboardView {
  rows: LeaderboardRow[];
  status: LeaderboardStatus;
  refresh: () => void;
}

export function useLeaderboard(): LeaderboardView {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [status, setStatus] = useState<LeaderboardStatus>('loading');

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading');
    try {
      const r = await fetch('/leaderboard', { signal });
      if (!r.ok) throw new Error(`leaderboard ${r.status}`);
      setRows((await r.json()) as LeaderboardRow[]);
      setStatus('ready');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // размонтировались — молча
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort(); // отменяем in-flight на unmount
  }, [load]);

  return { rows, status, refresh: () => void load() };
}
