/**
 * Чистая раскладка итога завершённой партии в строки БД (2.3.d). БЕЗ Socket.IO и БЕЗ подключения к БД
 * (типы строк берём из drizzle-схемы через `import(...)` в ТИПОВОЙ позиции — `db`-пул не трогаем), поэтому
 * тестируется на простых объектах. Источник состава — `MatchResult.standings` (зафиксирован на старте,
 * неизменен); `user_id` берём из мест комнаты по стабильному `playerId`.
 *
 * Граница (ADR-0011): зависим от платформенного контракта `MatchResult` и собственной схемы, НЕ от игрового
 * `src/core` — платформа не знает внутренних типов игры.
 */
import type { InferInsertModel } from 'drizzle-orm';
import type { MatchResult } from '../gameModule';

type MatchInsert = InferInsertModel<typeof import('../db/schema').matches>;
type MatchPlayerInsert = InferInsertModel<typeof import('../db/schema').matchPlayers>;

/** Минимум о месте, нужный для записи: стабильный id ↔ аккаунт. Структурно совместимо с `Seat` (seating.ts). */
export interface SeatRef {
  playerId: string;
  userId?: string | null;
}

/** Строки одной партии: одна `matches` + по строке на место. `matchId` проставит `recordMatch` после вставки. */
export interface MatchRows {
  match: MatchInsert;
  players: Omit<MatchPlayerInsert, 'matchId'>[];
}

/**
 * Собрать строки из итога и мест комнаты. Идём по `standings` (состав на старте — источник истины):
 * `is_winner` = членство id в `winnerIds`; `display_name`/`total` — из standings (имя уже нормализовано на
 * входе и застыло на старте — верная семантика истории); `user_id` — из места по `playerId`.
 *
 * Промах `playerId` среди мест (место сняли — будущий forfeit 2.2.c/2.4.c): НЕ падаем — пишем `user_id=null`
 * и зовём `onMissingSeat` (лог). Инвариант сейчас: места в идущей партии не сносятся, т.е. `seats ⊇ standings`.
 * `playerId` в БД НЕ пишем — он только для матчинга мест и `is_winner`.
 */
export function buildMatchRows(
  result: MatchResult,
  seats: readonly SeatRef[],
  gameId: string,
  onMissingSeat?: (playerId: string) => void,
): MatchRows {
  const winners = new Set(result.winnerIds);
  const seatByPlayer = new Map(seats.map((s) => [s.playerId, s]));

  const players: Omit<MatchPlayerInsert, 'matchId'>[] = result.standings.map((s) => {
    const seat = seatByPlayer.get(s.id);
    if (!seat) onMissingSeat?.(s.id); // место сняли (будущий forfeit) — пишем как гостя, не падаем
    return {
      userId: seat?.userId ?? null,
      displayName: s.name,
      total: s.total,
      isWinner: winners.has(s.id),
    };
  });

  const registeredCount = players.filter((p) => p.userId != null).length;

  return {
    match: { gameId, playerCount: players.length, registeredCount },
    players,
  };
}
