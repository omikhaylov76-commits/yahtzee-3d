/**
 * Игровой ник (ADR-0015) — ЧИСТЫЙ модуль (без DOM/Node), общий клиенту и серверу. Ник — отдельная
 * УНИКАЛЬНАЯ личность в игре, поверх Google-имени. Уникальность глобальная, без учёта регистра/локали:
 * сравниваем по «свёрнутому ключу» (`nicknameKey`). Содержимое наследуем из общей чистки имени
 * (`normalizeName`/`MAX_NAME_LEN`) — XSS/невидимки/длина уже сняты там; здесь добавляем минимальную
 * длину, ключ уникальности и резерв системных имён. Один источник правды: клиент (мгновенный фидбэк),
 * сервер (авторитет) и БД-ключ (`users.nickname_key`).
 */
import { MAX_NAME_LEN, normalizeName } from './names';

/** Минимальная длина ника (кодпойнтов) после нормализации. */
export const MIN_NICKNAME_LEN = 2;

/** Имя удалённого аккаунта (2.3.e-6): показывается вместо ника/имени; зарезервировано (см. ниже). */
export const DELETED_PLAYER_NAME = 'Deleted player';

/**
 * Свёрнутый ключ ника для уникальности БЕЗ учёта регистра. Локаль-ИНВАРИАНТНЫЙ `toLowerCase` (НЕ
 * `toLocaleLowerCase`: турецкие i/İ дали бы разный ключ в разных процессах/машинах — ADR-0015 M2).
 * `''` на выходе = валидного ника нет. Идемпотентен.
 */
export function nicknameKey(raw: string | undefined): string {
  return normalizeName(raw).toLowerCase();
}

/**
 * Валиден ли ник как ВВОД игрока: непустой после нормализации и в границах длины. XSS/невидимки уже
 * вырезаны `normalizeName` — здесь проверяем то, что осталось.
 */
export function isValidNickname(raw: string | undefined): boolean {
  const len = [...normalizeName(raw)].length; // по кодпойнтам, как MAX_NAME_LEN
  return len >= MIN_NICKNAME_LEN && len <= MAX_NAME_LEN;
}

/**
 * Зарезервированные ники (ADR-0015): системные имена, которые игрок занять НЕ может. Сверка по КЛЮЧУ
 * (та же свёртка `nicknameKey`). «deleted player» — подставляется при удалении аккаунта (нельзя выдать
 * себя за удалённого); «player N» — паттерн дефолтных имён мест гостей (нельзя слиться с ними).
 */
const RESERVED_EXACT = new Set([nicknameKey(DELETED_PLAYER_NAME)]);
const RESERVED_PATTERN = /^player \d+$/;

/** Принимает уже свёрнутый ключ (`nicknameKey(raw)`), не сырой ввод. */
export function isReservedNickname(key: string): boolean {
  return RESERVED_EXACT.has(key) || RESERVED_PATTERN.test(key);
}
