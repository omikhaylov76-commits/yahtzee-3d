import { useEffect, useMemo, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { Dice } from '../components/Dice';
import { RollCounter } from '../components/RollCounter';
import { ScoreTable } from '../components/ScoreTable';
import { DiceCanvas } from '../../render3d/DiceCanvas';
import { hasWebGL } from '../capabilities';
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
  const settling = useGameStore((s) => s.settling);
  const roll = useGameStore((s) => s.roll);
  const toggleHold = useGameStore((s) => s.toggleHold);
  const nudge = useGameStore((s) => s.nudge);

  // 3D-арена при наличии WebGL. 2D-кости — fallback ТОЛЬКО когда WebGL недоступен (F4.5).
  // reduced-motion больше не загоняет в 2D (3D — ядро впечатления); деликатный «reduced 3D»
  // (мгновенный бросок без тумбла) — в backlog на F6.
  const use3D = useMemo(() => hasWebGL(), []);

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
  // Пока кости летят (settling), бросок недоступен — ждём, когда 3D их «успокоит».
  const canRoll = state.phase === 'playing' && state.rollsLeft > 0 && !settling;
  const canHold =
    state.phase === 'playing' && state.rolledThisTurn && state.rollsLeft > 0 && !settling;
  // Nudge доступен, когда есть что трясти: кости брошены и лежат (не в полёте).
  const canNudge = state.phase === 'playing' && state.rolledThisTurn && !settling;

  return (
    <Screen className="game">
      <div className="game__layout">
        <section className="arena">
          <header className="turn">
            <Eyebrow>In play</Eyebrow>
            <h2 className="heading turn__name">{current.name}</h2>
            <RollCounter rollsLeft={state.rollsLeft} />
          </header>

          {use3D ? (
            <>
              <div className="dice-arena">
                <DiceCanvas dice={state.dice} canHold={canHold} />
              </div>
              {/* Скринридерам: значения 3D-костей (canvas им «непрозрачен») */}
              <p className="sr-only" role="status" aria-live="polite">
                {state.rolledThisTurn
                  ? `Dice: ${state.dice
                      .map((d) => `${d.value}${d.held ? ' held' : ''}`)
                      .join(', ')}`
                  : 'Dice not rolled yet'}
              </p>
            </>
          ) : (
            <Dice
              dice={state.dice}
              canHold={canHold}
              blank={!state.rolledThisTurn}
              onToggle={toggleHold}
            />
          )}

          <div className="controls">
            <Button variant="primary" className="roll-btn" onClick={roll} disabled={!canRoll}>
              {settling ? 'Rolling…' : state.rolledThisTurn ? 'Roll again' : 'Roll dice'}
            </Button>
            {use3D && (
              <Button
                variant="ghost"
                className="nudge-btn"
                onClick={nudge}
                disabled={!canNudge}
                title="Shake the table — dice hop and settle (values unchanged)"
              >
                Nudge
              </Button>
            )}
            <p className="controls__hint">
              {settling
                ? 'Dice are rolling…'
                : canHold
                  ? 'Tap a die to hold it.'
                  : 'Roll up to 3 times, then score.'}
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
