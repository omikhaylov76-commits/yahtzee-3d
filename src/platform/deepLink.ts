/**
 * Deep-link комнаты (2.2.c-2): код комнаты в адресе `?room=CODE` — чтобы делиться ССЫЛКОЙ, а не только
 * кодом. Здесь РАЗБОР ссылки (предзаполнить поле кода на входе) и ПОСТРОЕНИЕ ссылки-приглашения для
 * Copy/Share. Полный автовход (сразу в лобби) — 2.2.d. Чистый разбор (`parseRoomCode`) тестируется;
 * `roomCodeFromUrl`/`roomInviteUrl` — тонкие обёртки над `window.location`.
 */

/** Имя query-параметра с кодом комнаты. */
const ROOM_PARAM = 'room';
const CODE_MAX = 6;

/**
 * Достать код комнаты из строки запроса (`location.search`). Чистим по-клиентски (верхний регистр, только
 * `[0-9A-Z]`, не длиннее кода) — сервер при join всё равно валидирует строго (`normalizeCode`/`isValidCode`).
 * `null`, если параметра нет или после чистки пусто.
 */
export function parseRoomCode(search: string): string | null {
  const raw = new URLSearchParams(search).get(ROOM_PARAM);
  if (!raw) return null;
  const code = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, CODE_MAX);
  return code || null;
}

/** Код комнаты из текущего URL (deep-link). `null` вне браузера или без параметра. */
export function roomCodeFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return parseRoomCode(window.location.search);
}

/** Ссылка-приглашение в комнату по коду (для Copy/Share): текущий адрес + `?room=CODE`. */
export function roomInviteUrl(code: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?${ROOM_PARAM}=${encodeURIComponent(code)}`;
}
