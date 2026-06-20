import { useEffect, useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { NicknameForm } from '../components/NicknameForm';
import { useUiStore } from '../../state/uiStore';
import {
  fetchPlayerStats,
  useAuthStore,
  type DeleteError,
  type PlayerStats,
} from '../../state/authStore';
import { soloRecordStorage } from '../../storage/soloRecordStorage';

/** Инициалы для запасного аватара, когда нет картинки из Google. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => [...p][0]?.toUpperCase() ?? '').join('') || '?';
}

/** Тексты ошибок удаления аккаунта (2.3.e-6b). */
const DELETE_ERROR_TEXT: Record<DeleteError, string> = {
  in_game: 'Finish your current game first.',
  auth: 'Your session expired. Sign in again.',
  net: 'Network error. Try again.',
};

/**
 * Кабинет игрока (2.3.e-5): профиль (аватар + ник + Google-имя), статистика (онлайн из `/auth/stats` +
 * локальный соло-рекорд устройства), inline-смена ника (та же `NicknameForm`) и выход. Доступен из меню
 * залогиненному. Статистика — ЛОКАЛЬНОЕ состояние экрана (не глобалим в стор): тянем при открытии.
 */
export function CabinetScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setView = useUiStore((s) => s.setView);

  // Хуки — ДО любого раннего return (правила хуков). Тянем статистику один раз при открытии кабинета.
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [statsState, setStatsState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    fetchPlayerStats()
      .then((s) => {
        if (alive) {
          setStats(s);
          setStatsState('ready');
        }
      })
      .catch(() => {
        if (alive) setStatsState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  // Удаление аккаунта (2.3.e-6b): подтверждение словом «DELETE» → разлогин → меню. Хуки — до guard.
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<DeleteError | null>(null);
  const doDelete = async () => {
    if (confirmText !== 'DELETE' || delBusy) return;
    setDelBusy(true);
    setDelError(null);
    const res = await deleteAccount();
    if (res.ok) {
      setView('menu'); // удалён + разлогинен → в меню (как гость)
      return;
    }
    setDelError(res.reason);
    setDelBusy(false);
  };

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
  const soloBest = soloRecordStorage.load();

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
          <h2 className="cabinet__section-title">Online stats</h2>
          {statsState === 'loading' && <p className="cabinet__muted">Loading…</p>}
          {statsState === 'error' && (
            <p className="cabinet__muted">Couldn’t load stats right now.</p>
          )}
          {statsState === 'ready' && stats && (
            <dl className="stats-grid">
              <div className="stat">
                <dt>Played</dt>
                <dd>{stats.gamesPlayed}</dd>
              </div>
              <div className="stat">
                <dt>Wins</dt>
                <dd>{stats.wins}</dd>
              </div>
              <div className="stat">
                <dt>Win rate</dt>
                <dd>{stats.winRate === null ? '—' : `${Math.round(stats.winRate * 100)}%`}</dd>
              </div>
              <div className="stat">
                <dt>Best</dt>
                <dd>{stats.bestTotal ?? '—'}</dd>
              </div>
            </dl>
          )}
          {soloBest !== null && (
            <p className="cabinet__muted">
              Best solo (this device): <b>{soloBest}</b>
            </p>
          )}
        </section>

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

        <section className="cabinet__section cabinet__danger">
          <h2 className="cabinet__section-title">Danger zone</h2>
          {!confirming ? (
            <Button
              variant="ghost"
              className="cabinet__delete-go"
              onClick={() => setConfirming(true)}
            >
              Delete account
            </Button>
          ) : (
            <div className="cabinet__danger-confirm">
              <p className="cabinet__muted">
                This permanently deletes your account and frees your nickname. Past games show as
                &ldquo;Deleted player&rdquo;. This can&rsquo;t be undone — type <b>DELETE</b> to
                confirm.
              </p>
              <input
                className="player-row__input"
                type="text"
                value={confirmText}
                placeholder="DELETE"
                autoComplete="off"
                aria-label="Type DELETE to confirm account deletion"
                onChange={(e) => {
                  setConfirmText(e.target.value);
                  if (delError) setDelError(null);
                }}
              />
              {delError && (
                <p className="field-error" role="alert">
                  {DELETE_ERROR_TEXT[delError]}
                </p>
              )}
              <div className="cabinet__danger-actions">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                    setConfirmText('');
                    setDelError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="cabinet__delete-go"
                  disabled={confirmText !== 'DELETE' || delBusy}
                  onClick={() => void doDelete()}
                >
                  {delBusy ? 'Deleting…' : 'Permanently delete'}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Screen>
  );
}
