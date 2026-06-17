import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useGameStore } from '../../state/gameStore';
import { totalsFor } from '../scoreView';

/** Экран итогов: финальная таблица мест, подсветка победителя, рестарт. */
export function WinnerScreen() {
  const state = useGameStore((s) => s.state);
  const newGame = useGameStore((s) => s.newGame);
  const reset = useGameStore((s) => s.reset);
  if (!state) return null;

  const solo = state.players.length === 1;
  const winners = new Set(state.winnerIds);

  // Места по убыванию итога (исходный индекс сохраняем для подсветки победителя).
  const ranked = state.players
    .map((p, i) => ({ player: p, index: i, total: totalsFor(p).total }))
    .sort((a, b) => b.total - a.total);

  let title: string;
  if (solo) title = 'Final score';
  else if (state.winnerIds.length > 1) title = "It's a tie";
  else title = `${state.players[state.winnerIds[0]].name} wins`;

  const playAgain = () => newGame(state.players.map((p) => ({ name: p.name })));

  return (
    <Screen className="winner">
      <div className="winner__inner">
        <header className="winner__head">
          <Eyebrow>Game over</Eyebrow>
          <h1 className="display winner__title">{title}</h1>
        </header>

        <ol className="standings">
          {ranked.map((row, place) => (
            <li key={row.index} className={`standing${winners.has(row.index) ? ' is-winner' : ''}`}>
              <span className="standing__rank data" aria-hidden="true">
                {place + 1}
              </span>
              <span className="standing__name">{row.player.name}</span>
              <span className="standing__total data">{row.total}</span>
            </li>
          ))}
        </ol>

        <div className="winner__actions">
          <Button variant="primary" onClick={playAgain}>
            Play again
          </Button>
          <Button variant="ghost" onClick={reset}>
            New game
          </Button>
        </div>
      </div>
    </Screen>
  );
}
