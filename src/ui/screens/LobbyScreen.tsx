import { useEffect, useRef, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useGameStore } from '../../state/gameStore';
import { roomInviteUrl } from '../../platform/deepLink';

/**
 * Лобби онлайн-комнаты (2.2.a-2 → полировка a-3, Auros). Герой — код комнаты (им делятся): крупный
 * моно + Copy. Места «за столом» с фирменным pip-маркером (занято/ждём) и бейджами host/you. У хозяина —
 * Start (активна с 2 игроков), у всех — Leave. Показывается, пока `lobby && !state`; со стартом приходит
 * state и роутер уводит в GameScreen. Copy кода + Share ссылки + счётчик «кого ждём» — 2.2.c-2; у хозяина
 * Kick возле чужих мест — 2.2.c-1. Полный реванш — 2.4.b.
 */
export function LobbyScreen() {
  const lobby = useGameStore((s) => s.lobby);
  const mySeat = useGameStore((s) => s.mySeat);
  const roomCode = useGameStore((s) => s.roomCode);
  const startGameOnline = useGameStore((s) => s.startGameOnline);
  const kickPlayer = useGameStore((s) => s.kickPlayer);
  const goLocal = useGameStore((s) => s.goLocal);
  const setView = useUiStore((s) => s.setView);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [confirmKick, setConfirmKick] = useState<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const shareTimer = useRef<ReturnType<typeof setTimeout>>();
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();
  // Не дёргать setState после размонтирования (таймеры Copy-флага и «вооружённого» Kick).
  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
      clearTimeout(shareTimer.current);
      clearTimeout(confirmTimer.current);
    },
    [],
  );
  // Состав лобби изменился (вход/выход/кик) → снять «вооружение» Kick: индексы могли сдвинуться, и
  // второй клик выгнал бы не того, кого видел хозяин при первом клике (аудит c-1 M-1).
  useEffect(() => {
    setConfirmKick(null);
    clearTimeout(confirmTimer.current);
  }, [lobby?.players]);

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
  // Поделиться ссылкой-приглашением: на телефоне — нативный лист (navigator.share); на десктопе (нет Web
  // Share) — копируем ссылку в буфер. Отмену листа (AbortError) глотаем без фолбэка-копии.
  const share = async () => {
    if (!roomCode) return;
    const url = roomInviteUrl(roomCode);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Yahtzee 3D', url });
        return; // успех — поделились нативным листом
      } catch (e) {
        // AbortError = пользователь сам закрыл лист → ничего не навязываем. Иная ошибка share →
        // проваливаемся в копирование ссылки ниже (платформа с share, но он не сработал; аудит c-2 M-2).
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setShared(false), 1500);
    } catch {
      // буфер недоступен — код виден на экране, можно поделиться вручную
    }
  };
  // Kick в два клика (без window.confirm): первый «вооружает» место, второй (в течение 3с) — выгоняет.
  const armKick = (seat: number) => {
    clearTimeout(confirmTimer.current);
    if (confirmKick === seat) {
      kickPlayer(seat);
      setConfirmKick(null);
      return;
    }
    setConfirmKick(seat);
    confirmTimer.current = setTimeout(() => setConfirmKick(null), 3000);
  };
  const slots = Array.from({ length: lobby.capacity });
  // Роль хозяина — из СВЕЖЕГО состава лобби (не из store-поля): наследование хозяина на сервере сразу
  // даёт верную роль здесь, и кнопка Start появляется у промотированного игрока (аудит a-2 #1).
  const amHost = mySeat != null && !!lobby.players[mySeat]?.isHost;
  const filled = lobby.players.length;

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
            <button
              type="button"
              className="lobby__copy"
              onClick={copy}
              aria-label="Copy room code"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="lobby__copy"
              onClick={share}
              aria-label="Share invite link"
            >
              {shared ? 'Link copied' : 'Share link'}
            </button>
          </div>
          <p className="lobby__sub" role="status" aria-live="polite">
            {filled} of {lobby.capacity} players · share the code or link to invite more.
          </p>
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
                {amHost && p && i !== mySeat && (
                  <button
                    type="button"
                    className={`seat__kick${confirmKick === i ? ' is-armed' : ''}`}
                    onClick={() => armKick(i)}
                    aria-label={
                      confirmKick === i ? `Confirm removing ${p.name}` : `Remove ${p.name}`
                    }
                  >
                    {confirmKick === i ? 'Confirm' : 'Kick'}
                  </button>
                )}
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
