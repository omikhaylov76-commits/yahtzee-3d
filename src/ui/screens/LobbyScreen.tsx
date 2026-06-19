import { useEffect, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useGameStore } from '../../state/gameStore';

/**
 * Лобби онлайн-комнаты (2.2.a-2 → полировка a-3, Auros). Герой — код комнаты (им делятся): крупный
 * моно + Copy. Места «за столом» с фирменным pip-маркером (занято/ждём) и бейджами host/you. У хозяина —
 * Start (активна с 2 игроков), у всех — Leave. Показывается, пока `lobby && !state`; со стартом приходит
 * state и роутер уводит в GameScreen. Полный реванш/copy-link/share — 2.2.c/2.4.b.
 */
export function LobbyScreen() {
  const lobby = useGameStore((s) => s.lobby);
  const mySeat = useGameStore((s) => s.mySeat);
  const roomCode = useGameStore((s) => s.roomCode);
  const startGameOnline = useGameStore((s) => s.startGameOnline);
  const goLocal = useGameStore((s) => s.goLocal);
  const setView = useUiStore((s) => s.setView);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copyTimer.current), []); // не дёргать setCopied после размонтирования

  if (!lobby) return null; // роутер не показывает лобби без состава; защита от гонок размонтирования

  const leave = () => {
    goLocal();
    setView('menu');
  };
  const copy = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Буфер недоступен (нет разрешения/контекста) — код всё равно виден на экране, можно набрать вручную.
    }
  };
  const slots = Array.from({ length: lobby.capacity });
  // Роль хозяина — из СВЕЖЕГО состава лобби (не из store-поля): наследование хозяина на сервере сразу
  // даёт верную роль здесь, и кнопка Start появляется у промотированного игрока (аудит a-2 #1).
  const amHost = mySeat != null && !!lobby.players[mySeat]?.isHost;

  return (
    <Screen className="lobby">
      <div className="lobby__inner">
        <button type="button" className="back-link" onClick={leave}>
          ← Leave room
        </button>

        <header className="lobby__head">
          <Eyebrow>Online · lobby</Eyebrow>
          <p className="lobby__codelabel">Room code</p>
          <div className="lobby__codewrap">
            <span className="lobby__code data">{roomCode}</span>
            <button type="button" className="lobby__copy" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="lobby__sub">Share this code so friends can join.</p>
        </header>

        <ul className="seats" aria-label="Players in the room">
          {slots.map((_, i) => {
            const p = lobby.players[i];
            return (
              <li className={`seat${p ? ' is-filled' : ''}`} key={i}>
                <span className="seat__pip" aria-hidden="true" />
                <span className="seat__name">{p ? p.name : 'Waiting…'}</span>
                {p?.isHost && <span className="seat__badge">host</span>}
                {p && i === mySeat && <span className="seat__badge seat__badge--you">you</span>}
              </li>
            );
          })}
        </ul>

        {amHost ? (
          <div className="lobby__actions">
            <Button variant="primary" onClick={startGameOnline} disabled={!lobby.canStart}>
              Start game
            </Button>
            {!lobby.canStart && (
              <p className="lobby__hint">Waiting for one more player to start.</p>
            )}
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
