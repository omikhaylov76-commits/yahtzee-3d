import { useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 1;
const MAX_NAME_LEN = 20;
const COUNTS = [1, 2, 3, 4];

/** Экран старта: число игроков (1–4), имена, запуск партии. */
export function StartScreen() {
  const newGame = useGameStore((s) => s.newGame);
  const setView = useUiStore((s) => s.setView);
  const [count, setCount] = useState(2);
  const [names, setNames] = useState<string[]>(['', '', '', '']);

  const setName = (index: number, value: string) => {
    setNames((prev) => prev.map((n, i) => (i === index ? value.slice(0, MAX_NAME_LEN) : n)));
  };

  const start = () => {
    const players = Array.from({ length: count }, (_, i) => ({
      name: names[i].trim() || `Player ${i + 1}`,
    }));
    newGame(players);
  };

  return (
    <Screen>
      <form
        className="start"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <button type="button" className="back-link" onClick={() => setView('menu')}>
          ← Back to menu
        </button>

        <header className="start__head">
          <Eyebrow>Local · hotseat</Eyebrow>
          <h1 className="display start__title">Yahtzee 3D</h1>
          <p className="start__sub">
            Pass-and-play for {MIN_PLAYERS}–{MAX_PLAYERS} players.
          </p>
        </header>

        <section className="start__panel" aria-labelledby="count-label">
          <span className="field-label" id="count-label">
            Players
          </span>
          <div className="count-seg" role="group" aria-label="Number of players">
            {COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                className={`count-seg__btn${c === count ? ' is-active' : ''}`}
                aria-pressed={c === count}
                onClick={() => setCount(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </section>

        <section className="start__panel">
          <span className="field-label">Names</span>
          <ul className="players">
            {names.map((name, i) => {
              const active = i < count;
              return (
                <li className={`player-row${active ? '' : ' is-inactive'}`} key={i}>
                  <span className="player-row__index data" aria-hidden="true">
                    {i + 1}
                  </span>
                  <input
                    className="player-row__input"
                    type="text"
                    value={name}
                    maxLength={MAX_NAME_LEN}
                    placeholder={`Player ${i + 1}`}
                    aria-label={`Name of player ${i + 1}`}
                    disabled={!active}
                    tabIndex={active ? 0 : -1}
                    onChange={(e) => setName(i, e.target.value)}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        <div className="start__actions">
          <Button variant="primary" type="submit" className="start__cta">
            Start game
          </Button>
        </div>
      </form>
    </Screen>
  );
}
