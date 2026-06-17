import { useEffect, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { Dice } from '../components/Dice';
import { RollCounter } from '../components/RollCounter';
import { ScoreTable } from '../components/ScoreTable';
import { useGameStore } from '../../state/gameStore';

/** Понятное сообщение для отклонённого действия (из доменных событий ядра). */
function deniedMessage(reason: string): string {
  switch (reason) {
    case 'roll-not-allowed':
      return 'No rolls left — score a category.';
    case 'hold-not-allowed':
      return 'Roll the dice first.';
    case 'score-before-roll':
      return 'Roll the dice first.';
    case 'category-taken':
      return 'That category is already filled.';
    default:
      return "Can't do that right now.";
  }
}

/** Экран игры (F3.3): арена костей + контролы. Таблица счёта подключается в F3.4. */
export function GameScreen() {
  const state = useGameStore((s) => s.state);
  const events = useGameStore((s) => s.events);
  const roll = useGameStore((s) => s.roll);
  const toggleHold = useGameStore((s) => s.toggleHold);

  const [denied, setDenied] = useState<{ msg: string; key: number } | null>(null);
  const nonce = useRef(0);
  useEffect(() => {
    const last = [...events].reverse().find((e) => e.type === 'action:denied');
    if (last && last.type === 'action:denied') {
      nonce.current += 1;
      setDenied({ msg: deniedMessage(last.reason), key: nonce.current });
      const t = setTimeout(() => setDenied(null), 1800);
      return () => clearTimeout(t);
    }
  }, [events]);

  if (!state) return null; // роутер не покажет этот экран без партии

  const current = state.players[state.current];
  const canRoll = state.phase === 'playing' && state.rollsLeft > 0;
  const canHold = state.phase === 'playing' && state.rolledThisTurn && state.rollsLeft > 0;

  return (
    <Screen className="game">
      <div className="game__layout">
        <section className="arena">
          <header className="turn">
            <Eyebrow>In play</Eyebrow>
            <h2 className="heading turn__name">{current.name}</h2>
            <RollCounter rollsLeft={state.rollsLeft} />
          </header>

          <Dice
            dice={state.dice}
            canHold={canHold}
            blank={!state.rolledThisTurn}
            onToggle={toggleHold}
          />

          <div className="controls">
            <Button variant="primary" className="roll-btn" onClick={roll} disabled={!canRoll}>
              {state.rolledThisTurn ? 'Roll again' : 'Roll dice'}
            </Button>
            <p className="controls__hint">
              {canHold ? 'Tap a die to hold it.' : 'Roll up to 3 times, then score.'}
            </p>
          </div>

          <p className={`denied${denied ? ' is-shown' : ''}`} role="status" key={denied?.key}>
            {denied?.msg ?? ''}
          </p>
        </section>

        <ScoreTable />
      </div>
    </Screen>
  );
}
