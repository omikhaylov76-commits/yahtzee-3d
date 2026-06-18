import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';

/**
 * Заглушка онлайн-режима (2.L.a). Реальная сеть — Веха 2, под-шаги 2.0+ (комнаты, вход,
 * лидерборд). Здесь только честная коммуникация и возврат в меню.
 */
export function OnlineComingSoon() {
  const setView = useUiStore((s) => s.setView);

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

        <div className="coming__actions">
          <Button variant="ghost" onClick={() => setView('menu')}>
            ← Back to menu
          </Button>
        </div>
      </div>
    </Screen>
  );
}
