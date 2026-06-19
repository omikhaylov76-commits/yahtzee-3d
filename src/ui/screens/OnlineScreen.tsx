import { useEffect } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useGameStore } from '../../state/gameStore';
import type { OnlineStatus } from '../../platform/net';

/**
 * Экран соединения онлайн-режима (2.1.d-1). На входе подключает сетевой транспорт (`goOnline`),
 * показывает статус соединения/комнаты, по «Back to menu» — отключает (`goLocal`). Когда от сервера
 * приходит состояние партии, роутер сам показывает `GameScreen` (этот экран размонтируется) —
 * поэтому `goLocal` зовём ТОЛЬКО по явной кнопке, не в cleanup (иначе оборвём старт партии).
 * Гейтинг кнопок/баннеры в самой партии — 2.1.d-2.
 */
const STATUS_LABEL: Record<OnlineStatus, string> = {
  connecting: 'Connecting to server…',
  offline: 'Server is offline — try again later',
  mismatch: 'Version mismatch — please refresh the page',
  waiting: 'Waiting for an opponent to join…',
  full: 'This room is full — try again later',
  playing: 'Starting the game…',
};

export function OnlineScreen() {
  const setView = useUiStore((s) => s.setView);
  const goOnline = useGameStore((s) => s.goOnline);
  const goLocal = useGameStore((s) => s.goLocal);
  const status = useGameStore((s) => s.onlineStatus) ?? 'connecting';

  // Подключаемся при входе на экран. `goOnline` идемпотентен (повторный вызов — no-op),
  // поэтому повторный прогон эффекта в dev/StrictMode безопасен; сессию НЕ закрываем в cleanup.
  useEffect(() => {
    goOnline();
  }, [goOnline]);

  const back = () => {
    goLocal();
    setView('menu');
  };

  return (
    <Screen className="coming">
      <div className="coming__inner">
        <header className="coming__head">
          <Eyebrow>Online</Eyebrow>
          <h1 className="display coming__title">Play online</h1>
          <p className="coming__sub">
            Share this device&apos;s link with a friend, or open a second tab — the game starts when
            two players are in the room.
          </p>
        </header>

        <p className={`conn-status conn-status--${status}`} role="status" aria-live="polite">
          {STATUS_LABEL[status]}
        </p>

        <div className="coming__actions">
          <Button variant="ghost" onClick={back}>
            ← Back to menu
          </Button>
        </div>
      </div>
    </Screen>
  );
}
