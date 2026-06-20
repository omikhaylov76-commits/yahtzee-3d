/**
 * Решение «писать ли итог завершённой партии» + сборка строк (2.3.d-2). Вынесено из realtime, чтобы триггер и
 * guard были юнит-тестируемы без сокетов/БД (socket-обвязка realtime юнитом не покрывается).
 *
 * Возвращает строки ТОЛЬКО если: (1) партия естественно завершилась — `game:over` среди событий действия; и
 * (2) есть ≥1 зарегистрированный игрок. Иначе null: партия ещё идёт / брошена (game:over не наступает) / только
 * гости (в историю/рейтинг не пишем — политика зачёта 2.4.a). Триггер по СОБЫТИЮ (не по фазе): дубль actionId
 * не порождает событий и сюда не доходит (realtime отсекает duplicate раньше) — записи не задвоить.
 */
import { buildMatchRows, type MatchRows, type SeatRef } from './buildRows';
import type { MatchResult } from '../gameModule';

export function rowsForCompletedGame(
  events: readonly { type: string }[],
  result: MatchResult,
  seats: readonly SeatRef[],
  gameId: string,
  onMissingSeat?: (playerId: string) => void,
): MatchRows | null {
  if (!events.some((e) => e.type === 'game:over')) return null;
  const rows = buildMatchRows(result, seats, gameId, onMissingSeat);
  if (rows.match.registeredCount < 1) return null; // только гости — в историю/рейтинг не пишем
  return rows;
}
