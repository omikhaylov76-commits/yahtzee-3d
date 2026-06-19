import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useGameStore } from '../../state/gameStore';

/**
 * Лобби онлайн-комнаты (2.2.a-2): код для шаринга, состав игроков (с пометкой host/you), у хозяина —
 * кнопка Start (активна с 2 игроков), у всех — Leave. Показывается роутером, пока есть состав лобби и
 * партия не началась (`mode==='online' && lobby && !state`). Когда хозяин стартует и приходит state,
 * роутер сам покажет GameScreen (этот экран размонтируется). Дизайн-полировка — a-3.
 */
export function LobbyScreen() {
  const lobby = useGameStore((s) => s.lobby);
  const mySeat = useGameStore((s) => s.mySeat);
  const roomCode = useGameStore((s) => s.roomCode);
  const startGameOnline = useGameStore((s) => s.startGameOnline);
  const goLocal = useGameStore((s) => s.goLocal);
  const setView = useUiStore((s) => s.setView);

  if (!lobby) return null; // роутер не показывает лобби без состава; защита от гонок размонтирования

  const leave = () => {
    goLocal();
    setView('menu');
  };
  const slots = Array.from({ length: lobby.capacity });
  // Роль хозяина берём из СВЕЖЕГО состава лобби (а не из store-поля, выставленного один раз в `joined`):
  // когда создатель выходит, сервер передаёт роль (`ensureHost`) и шлёт новый `room:lobby` — так
  // промотированный игрок СРАЗУ увидит кнопку Start (иначе лобби «залипало» бы без старта).
  const amHost = mySeat != null && !!lobby.players[mySeat]?.isHost;

  return (
    <Screen className="lobby">
      <div className="lobby__inner">
        <button type="button" className="back-link" onClick={leave}>
          ← Leave room
        </button>

        <header className="lobby__head">
          <Eyebrow>Online · lobby</Eyebrow>
          <h1 className="display lobby__title">Room code</h1>
          <p className="lobby__code data" aria-label={`Room code ${roomCode ?? ''}`}>
            {roomCode}
          </p>
          <p className="lobby__sub">Share this code with friends so they can join.</p>
        </header>

        <ul className="players lobby__players">
          {slots.map((_, i) => {
            const p = lobby.players[i];
            return (
              <li className={`player-row${p ? '' : ' is-inactive'}`} key={i}>
                <span className="player-row__index data" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="lobby__name">
                  {p ? p.name : 'Waiting…'}
                  {p?.isHost && <span className="lobby__badge">host</span>}
                  {p && i === mySeat && <span className="lobby__badge lobby__badge--you">you</span>}
                </span>
              </li>
            );
          })}
        </ul>

        {amHost ? (
          <div className="lobby__actions">
            <Button variant="primary" onClick={startGameOnline} disabled={!lobby.canStart}>
              Start game
            </Button>
            {!lobby.canStart && <p className="lobby__hint">Need at least 2 players to start.</p>}
          </div>
        ) : (
          <p className="lobby__hint" role="status" aria-live="polite">
            Waiting for the host to start…
          </p>
        )}
      </div>
    </Screen>
  );
}
