import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { Dice } from '../components/Dice';
import { RollCounter } from '../components/RollCounter';
import { ScoreTable } from '../components/ScoreTable';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { hasWebGL } from '../capabilities';
import { totalsFor } from '../scoreView';
import { useGameStore, useInputLocked, useTurnBanner, useWaitingFor } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';

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

// Оверлей «ждём отсутствующего игрока» (2.4.c-3-2): пока текущий ходящий не на связи, сервер доиграет
// за него (форфейт, 2.4.c-2). Отсчёт ПРИБЛИЗИТЕЛЬНЫЙ (ориентир): локальный таймер; реальный форфейт
// сервера 60–120с. pointer-events:none — оверлей информативный, «← Menu» остаётся кликабельным.
const FORFEIT_COUNTDOWN_S = 60; // зеркалит серверный FORFEIT_MS (приблизительно, см. 2.4.c-2)

function WaitingOverlay() {
  const waiting = useWaitingFor();
  const targetId = waiting?.playerId ?? null;
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (targetId == null) {
      setRemaining(null);
      return;
    }
    const start = Date.now();
    setRemaining(FORFEIT_COUNTDOWN_S);
    const id = setInterval(() => {
      const left = FORFEIT_COUNTDOWN_S - Math.floor((Date.now() - start) / 1000);
      setRemaining(left > 0 ? left : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [targetId]);

  if (!waiting) return null;
  return (
    <div className="waiting-overlay">
      <div className="waiting-overlay__card">
        {/* Имя игрока экранируется React'ом (XSS-задел CLAUDE.md): это пользовательский ввод. */}
        <p className="waiting-overlay__title" role="status" aria-live="polite">
          Waiting for {waiting.name} to reconnect…
        </p>
        {/* Отсчёт — визуальный ориентир; aria-hidden, чтобы скринридер не диктовал каждую секунду. */}
        <p className="waiting-overlay__count" aria-hidden="true">
          {remaining != null && remaining > 0 ? `${remaining}s` : 'finishing…'}
        </p>
      </div>
    </div>
  );
}

/** Экран игры (F3.3): арена костей + контролы. Таблица счёта подключается в F3.4. */
export function GameScreen() {
  const state = useGameStore((s) => s.state);
  const events = useGameStore((s) => s.events);
  const settling = useGameStore((s) => s.settling);
  const roll = useGameStore((s) => s.roll);
  const toggleHold = useGameStore((s) => s.toggleHold);
  const nudge = useGameStore((s) => s.nudge);
  const reset = useGameStore((s) => s.reset);
  const mode = useGameStore((s) => s.mode);
  // Сетевой гейтинг ввода (2.1.d-3): в local оба «выключены» (locked=false, banner=null) — поведение
  // Вехи 1 не меняется. В сети блокируем контролы в чужой ход / pending / при разрыве и поясняем баннером.
  const locked = useInputLocked();
  const banner = useTurnBanner();
  const setView = useUiStore((s) => s.setView);

  // Выход в меню из НЕЗАВЕРШЁННОЙ партии (2.1.d-2): двухшаговое подтверждение, чтобы случайно не
  // потерять hotseat-игру. Выход идёт через mode-aware reset() (online = покинуть комнату, local =
  // стереть партию) + переход в меню. Esc отменяет подтверждение.
  const [confirming, setConfirming] = useState(false);
  const exitBtnRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);
  // a11y: при отмене подтверждения (Esc/Cancel) вернуть фокус на «← Menu», чтобы клавиатура не
  // теряла позицию. Срабатывает только на переходе confirming→false (не на маунте экрана).
  useEffect(() => {
    if (wasConfirming.current && !confirming) exitBtnRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const leaveToMenu = () => {
    reset();
    setView('menu');
  };

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
  // Пока кости летят (settling), бросок недоступен — ждём, когда 3D их «успокоит». В сети поверх
  // накладывается серверный гейт `locked` (чужой ход / pending / разрыв) — ADR-0013, 2.1.d-3.
  const canRoll = state.phase === 'playing' && state.rollsLeft > 0 && !settling && !locked;
  const canHold =
    state.phase === 'playing' &&
    state.rolledThisTurn &&
    state.rollsLeft > 0 &&
    !settling &&
    !locked;
  // Nudge доступен, когда есть что трясти: кости брошены и лежат (не в полёте).
  const canNudge = state.phase === 'playing' && state.rolledThisTurn && !settling && !locked;

  // 2D-кости: и как путь без WebGL, и как запасной вариант при сбое загрузки 3D-чанка (F6.4).
  const dice2D = (
    <Dice dice={state.dice} canHold={canHold} blank={!state.rolledThisTurn} onToggle={toggleHold} />
  );

  return (
    <Screen className="game">
      <div className="game__layout">
        <section className="arena">
          {confirming ? (
            <div className="game-exit game-exit--confirm" role="group" aria-label="Leave game">
              <span className="game-exit__msg">
                {mode === 'online'
                  ? 'Leave the online game?'
                  : 'Leave game? Your current game will be lost.'}
              </span>
              <button type="button" className="game-exit__btn is-danger" onClick={leaveToMenu}>
                Leave
              </button>
              <button
                type="button"
                className="game-exit__btn"
                onClick={() => setConfirming(false)}
                autoFocus
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              ref={exitBtnRef}
              type="button"
              className="back-link game-exit__open"
              onClick={() => setConfirming(true)}
              aria-label="Leave game and return to menu"
            >
              ← Menu
            </button>
          )}

          <header className="turn">
            <Eyebrow>In play</Eyebrow>
            <h2 className="display turn__name">{current.name}</h2>
            {/* F7.1: «терминальная» строка-статистика — живой счёт игрока + счётчик бросков. */}
            <div className="turn__meta">
              <span className="turn__total">
                <span className="turn__total-num data">{totalsFor(current).total}</span>
                <span className="turn__total-label">pts</span>
              </span>
              <span className="turn__sep" aria-hidden="true" />
              <RollCounter rollsLeft={state.rollsLeft} />
            </div>
            {/* Сетевой баннер (2.1.d-3): «ход соперника» / «соединение потеряно». В local — null. */}
            {banner && (
              <p className="turn__banner" role="status" aria-live="polite">
                {banner}
              </p>
            )}
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

          {/* 2.4.c-3-2: оверлей «ждём отсутствующего игрока» поверх зоны костей (информативный). */}
          <WaitingOverlay />

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

          <p
            className={`denied${denied ? ' is-shown' : ''}`}
            role="status"
            aria-live="polite"
            key={denied?.key}
          >
            {denied?.msg ?? ''}
          </p>
        </section>

        <ScoreTable />
      </div>
    </Screen>
  );
}
