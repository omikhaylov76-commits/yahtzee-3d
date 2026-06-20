import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { useUiStore } from '../../state/uiStore';

/**
 * Точка входа (2.L.a, ADR-0014): выбор режима — локально (hotseat/соло) или по сети.
 * Онлайн пока ведёт на заглушку (реальная сеть — под-шаги 2.0+).
 */
// Вход через Google (2.3.b-2): ведёт на серверный OAuth-маршрут. В проде клиент раздаётся тем же
// сервером (same-origin) → относительный путь; в dev сервер на :3001.
const GOOGLE_LOGIN_URL = `${import.meta.env.DEV ? 'http://localhost:3001' : ''}/auth/google/start`;

export function MenuScreen() {
  const setView = useUiStore((s) => s.setView);

  return (
    <Screen className="menu">
      <div className="menu__inner">
        <header className="menu__head">
          <Eyebrow>Dice · Yahtzee</Eyebrow>
          <h1 className="display menu__title">Yahtzee 3D</h1>
          <p className="menu__sub">Choose how to play.</p>
        </header>

        <nav className="menu__modes" aria-label="Game mode">
          <button
            type="button"
            className="mode-btn mode-btn--primary"
            onClick={() => setView('localSetup')}
          >
            <span className="mode-btn__title">Play local</span>
            <span className="mode-btn__desc">Hotseat or solo on this device</span>
          </button>
          <button type="button" className="mode-btn" onClick={() => setView('online')}>
            <span className="mode-btn__title">Play online</span>
            <span className="mode-btn__desc">With friends across devices</span>
          </button>
        </nav>

        <div className="menu__account">
          <a className="menu__signin" href={GOOGLE_LOGIN_URL}>
            Sign in with Google
          </a>
          <p className="menu__account-note">Optional — saves your stats &amp; leaderboard later.</p>
        </div>
      </div>
    </Screen>
  );
}
