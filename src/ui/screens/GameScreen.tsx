import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { Dice } from '../components/Dice';
import { RollCounter } from '../components/RollCounter';
import { ScoreTable } from '../components/ScoreTable';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { hasWebGL } from '../capabilities';
import { useGameStore } from '../../state/gameStore';

// F6.4: 3D-арена (Three.js + Rapier WASM, ~3 МБ) грузится ЛЕНИВО отдельным чанком — только
// когда есть WebGL и экран игры реально показан. 2D-fallback и стартовый экран её не тянут.
const DiceCanvas = lazy(() =>
  import('../../render3d/DiceCanvas').then((m) => ({ default: m.DiceCanvas })),
);

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

  // 2D-кости: и как путь без WebGL, и как запасной вариант при сбое загрузки 3D-чанка (F6.4).
  const dice2D = (
    <Dice dice={state.dice} canHold={canHold} blank={!state.rolledThisTurn} onToggle={toggleHold} />
  );

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
              {/* Если ленивый 3D-чанк не загрузится — деградируем в 2D, а не в белый экран (F6.4). */}
              <ErrorBoundary fallback={dice2D}>
                <div className="dice-arena">
                  <Suspense fallback={<div className="dice-arena__loading" aria-hidden="true" />}>
                    <DiceCanvas dice={state.dice} canHold={canHold} />
                  </Suspense>
                </div>
              </ErrorBoundary>
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
            dice2D
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
