import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { NicknameForm } from '../components/NicknameForm';
import { useUiStore } from '../../state/uiStore';
import { useAuthStore } from '../../state/authStore';

/** Инициалы для запасного аватара, когда нет картинки из Google. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => [...p][0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * Кабинет игрока (2.3.e-5a): профиль (аватар + ник + Google-имя) и inline-смена ника (та же
 * `NicknameForm`) + выход. Статистика и соло-рекорд — e-5b. Доступен из меню для залогиненного.
 */
export function CabinetScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setView = useUiStore((s) => s.setView);

  // Без сессии в кабинете делать нечего (роутер сюда обычно не пускает) — даём уйти в меню.
  if (!user) {
    return (
      <Screen className="coming">
        <div className="online-entry">
          <button type="button" className="back-link" onClick={() => setView('menu')}>
            ← Back to menu
          </button>
          <p className="coming__sub">You are not signed in.</p>
        </div>
      </Screen>
    );
  }

  const display = user.nickname ?? user.displayName;
  const hasNick = !!user.nickname;

  return (
    <Screen className="coming">
      <div className="online-entry cabinet">
        <button type="button" className="back-link" onClick={() => setView('menu')}>
          ← Back to menu
        </button>

        <header className="cabinet__profile">
          {user.avatarUrl ? (
            <img
              className="cabinet__avatar"
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="cabinet__avatar cabinet__avatar--initials" aria-hidden="true">
              {initials(display)}
            </div>
          )}
          <div className="cabinet__id">
            <Eyebrow>Account</Eyebrow>
            <h1 className="display cabinet__name">{display}</h1>
            {hasNick && <p className="cabinet__sub">{user.displayName}</p>}
          </div>
        </header>

        <section className="cabinet__section">
          <h2 className="cabinet__section-title">
            {hasNick ? 'Change nickname' : 'Pick a nickname'}
          </h2>
          <NicknameForm
            submitLabel={hasNick ? 'Save nickname' : 'Set nickname'}
            onDone={() => {}}
          />
        </section>

        <Button variant="ghost" className="cabinet__signout" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </Screen>
  );
}
