/**
 * Список открытых/дежурных столов (2.5.d-2, ADR-0017). Лёгкий ХУК (а не глобальный стор): владелец
 * интервала опроса — экран, поэтому таймер живёт ровно пока открыт `TablesScreen` (mount→poll,
 * unmount→stop) и не переживает экран. Опрос HTTP `GET /tables` (в dev через Vite-proxy на :3001,
 * в проде same-origin) — НЕ сокет (список — lobby-слой платформы, не игровая сессия, см. аудит).
 *
 * Жизненный цикл (аудит): пауза на скрытой вкладке (`document.hidden`), отмена in-flight через
 * AbortController при размонтировании, без наложения запросов. Состояние держит хук, не синглтон.
 */
import { useCallback, useEffect, useState } from 'react';
import type { OpenTable } from '../../shared/protocol';

export type TablesStatus = 'loading' | 'ready' | 'error';

const POLL_MS = 4000; // лёгкий опрос; дружеский масштаб — этого хватает (не realtime-стрим)

export interface OpenTablesView {
  tables: OpenTable[];
  status: TablesStatus;
  /** Ручное обновление (кнопка Try again / после неудачного входа). */
  refresh: () => void;
}

export function useOpenTables(): OpenTablesView {
  const [tables, setTables] = useState<OpenTable[]>([]);
  const [status, setStatus] = useState<TablesStatus>('loading');

  // `initial` помечает первую загрузку — показываем «loading»; тихие опросы статус не сбрасывают
  // (иначе список мигал бы «loading» каждые 4с). Ошибку опроса не раздуваем, если данные уже есть.
  const load = useCallback(async (signal?: AbortSignal, initial = false) => {
    if (initial) setStatus('loading');
    try {
      const r = await fetch('/tables', { signal });
      if (!r.ok) throw new Error(`tables ${r.status}`);
      const data = (await r.json()) as OpenTable[];
      setTables(data);
      setStatus('ready');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // размонтировались — молча
      setStatus((prev) => (prev === 'ready' ? 'ready' : 'error')); // есть данные → не рушим в error
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal, true);
    const id = setInterval(() => {
      if (!document.hidden) void load(ac.signal); // на скрытой вкладке не опрашиваем
    }, POLL_MS);
    return () => {
      ac.abort(); // отменяем in-flight
      clearInterval(id); // таймер не переживает экран
    };
  }, [load]);

  return { tables, status, refresh: () => void load(undefined, true) };
}
