import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useLeaderboard } from '../../state/leaderboard';

/**
 * Экран публичного лидерборда (2.4.a-2, ADR-0018): топ игроков по сумме очков честных сетевых партий.
 * Богатая строка (ник+аватар · очки · лучшая · сыграно · победы) в `<table>` (a11y: `scope`, моно-числа);
 * на узком экране таблица прокручивается. Состояния загрузка/пусто/ошибка. Только публичные поля.
 */
export function LeaderboardScreen() {
  const setView = useUiStore((s) => s.setView);
  const { rows, status, refresh } = useLeaderboard();

  return (
    <Screen className="coming">
      <div className="online-entry leaderboard">
        <button type="button" className="back-link" onClick={() => setView('menu')}>
          ← Back to menu
        </button>

        <header className="coming__head online-entry__head">
          <Eyebrow>Online · leaderboard</Eyebrow>
          <h1 className="display coming__title">Leaderboard</h1>
          <p className="coming__sub">Top players by total points across rated online games.</p>
        </header>

        {status === 'loading' && (
          <p className="tables__msg" role="status" aria-busy="true">
            Loading…
          </p>
        )}

        {status === 'error' && (
          <div className="tables__msg" role="status">
            <span className="conn-status conn-status--offline">
              Couldn&rsquo;t load the leaderboard.
            </span>
            <Button onClick={refresh}>Try again</Button>
          </div>
        )}

        {status === 'ready' && rows.length === 0 && (
          <p className="tables__msg">No rated games yet — play some online matches!</p>
        )}

        {status === 'ready' && rows.length > 0 && (
          <div className="lb-board">
            <ol className="lb" aria-label="Top players by total points">
              {rows.map((r, i) => (
                <li
                  key={`${r.nickname}-${i}`}
                  className={`lb__row${i === 0 ? ' is-leader' : ''}`}
                  aria-label={`#${i + 1} ${r.nickname}: ${r.points} points, best ${r.best}, ${r.played} games, ${r.wins} wins`}
                >
                  <span className={`lb__rank lb__rank--${i < 3 ? i + 1 : 'n'}`} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="lb__ava">
                    {r.avatarUrl ? (
                      <img
                        className="lb__avatar"
                        src={r.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="lb__avatar" aria-hidden="true">
                        {r.nickname.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {i === 0 && (
                      <svg
                        className="lb__crown"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        aria-hidden="true"
                      >
                        <path fill="currentColor" d="M5 16L3 6l5.5 4L12 4l3.5 6L21 6l-2 10H5z" />
                      </svg>
                    )}
                  </span>
                  <div className="lb__who">
                    <span className="lb__name">
                      <span className="lb__name-text">{r.nickname}</span>
                    </span>
                    <span className="lb__meta data">
                      Best {r.best} · {r.played} {r.played === 1 ? 'game' : 'games'} · {r.wins}{' '}
                      {r.wins === 1 ? 'win' : 'wins'}
                    </span>
                  </div>
                  <span className="lb__points" aria-hidden="true">
                    <span className="lb__points-num data">{r.points}</span>
                    <span className="lb__points-label">pts</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Screen>
  );
}
