import { useEffect, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { connectPlatform, type ConnStatus } from '../../platform/net';

/**
 * Заглушка онлайн-режима (2.0.a) + проба соединения с платформой (2.0.c). Реальное лобби/
 * комнаты — Веха 2, под-шаги 2.2+. Пока проверяем «hello world по сети»: подключение к серверу
 * и совпадение версии протокола.
 */
const STATUS_LABEL: Record<ConnStatus, string> = {
  connecting: 'Connecting to server…',
  connected: 'Connected · protocol v1',
  mismatch: 'Version mismatch — please refresh',
  offline: 'Server offline',
};

export function OnlineComingSoon() {
  const setView = useUiStore((s) => s.setView);
  const [status, setStatus] = useState<ConnStatus>('connecting');

  useEffect(() => {
    const socket = connectPlatform(setStatus);
    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <Screen className="coming">
      <div className="coming__inner">
        <header className="coming__head">
          <Eyebrow>Online</Eyebrow>
          <h1 className="display coming__title">Coming soon</h1>
          <p className="coming__sub">
            Online rooms, accounts and leaderboards are on the way. For now, gather around one
            device and play local.
          </p>
        </header>

        <p className={`conn-status conn-status--${status}`} role="status">
          {STATUS_LABEL[status]}
        </p>

        <div className="coming__actions">
          <Button variant="ghost" onClick={() => setView('menu')}>
            ← Back to menu
          </Button>
        </div>
      </div>
    </Screen>
  );
}
