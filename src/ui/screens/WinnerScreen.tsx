import { useEffect, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { soloRecordStorage, type SoloRecordResult } from '../../storage/soloRecordStorage';
import { totalsFor } from '../scoreView';

/** Экран итогов: финальная таблица мест, подсветка победителя, рестарт. */
export function WinnerScreen() {
  const state = useGameStore((s) => s.state);
  const newGame = useGameStore((s) => s.newGame);
  const reset = useGameStore((s) => s.reset);
  const setView = useUiStore((s) => s.setView);
  // Хуки — ДО раннего return (правила хуков). Значения считаем с защитой от null-состояния.
  const [rec, setRec] = useState<SoloRecordResult | null>(null);

  const solo = !!state && state.players.length === 1;
  // Места по убыванию итога (исходный индекс сохраняем для подсветки победителя).
  const ranked = state
    ? state.players
        .map((p, i) => ({ player: p, index: i, total: totalsFor(p).total }))
        .sort((a, b) => b.total - a.total)
    : [];
  // Соло (2.L.b): учитываем персональный локальный рекорд один раз на маунте экрана итогов.
  // record() идемпотентен — перезагрузка на этом экране рекорд не накручивает.
  const soloTotal = solo ? ranked[0].total : 0;
  useEffect(() => {
    if (solo) setRec(soloRecordStorage.record(soloTotal));
  }, [solo, soloTotal]);

  if (!state) return null;

  const winners = new Set(state.winnerIds);
  let title: string;
  if (solo) title = 'Final score';
  else if (state.winnerIds.length > 1) title = "It's a tie";
  else title = `${state.players[state.winnerIds[0]].name} wins`;

  const playAgain = () => newGame(state.players.map((p) => ({ name: p.name })));
  // «Main menu»: очистить партию (reset) и вернуться в меню выбора режима (2.L.a, ADR-0014).
  const toMenu = () => {
    reset();
    setView('menu');
  };

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

        {solo && rec && (
          <p className={`solo-record${rec.isRecord ? ' is-new' : ''}`}>
            {rec.isRecord ? '★ New personal record' : `Personal best: ${rec.best}`}
          </p>
        )}

        <div className="winner__actions">
          <Button variant="primary" onClick={playAgain}>
            Play again
          </Button>
          <Button variant="ghost" onClick={toMenu}>
            Main menu
          </Button>
        </div>
      </div>
    </Screen>
  );
}
