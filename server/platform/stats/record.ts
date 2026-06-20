/**
 * Запись итога завершённой партии в БД (2.3.d). Берёт готовые строки (`buildMatchRows`) и вставляет
 * `matches` + `match_players` в ОДНОЙ транзакции — не бывает «матча без игроков». Ленивый импорт `db`:
 * модуль подключается лишь там, где БД реально нужна (как auth), чтобы сервер без БД не падал на старте.
 *
 * Guard «≥1 зарегистрированный» и fire-and-forget с логом ошибки — на стороне вызывающего (realtime, d-2):
 * БД вне горячего пути (ADR-0009), сбой записи не должен ронять партию.
 */
import { db, schema } from '../db';
import type { MatchRows } from './buildRows';

/** Вставить партию и её участников атомарно. Возвращает id созданной партии. */
export async function recordMatch(rows: MatchRows): Promise<string> {
  return db.transaction(async (tx) => {
    const [match] = await tx
      .insert(schema.matches)
      .values(rows.match)
      .returning({ id: schema.matches.id });
    await tx
      .insert(schema.matchPlayers)
      .values(rows.players.map((p) => ({ ...p, matchId: match.id })));
    return match.id;
  });
}
