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
          <div className="lb-wrap">
            <table className="lb">
              <thead>
                <tr>
                  <th scope="col" className="lb__rank">
                    #
                  </th>
                  <th scope="col">Player</th>
                  <th scope="col" className="lb__num">
                    Points
                  </th>
                  <th scope="col" className="lb__num">
                    Best
                  </th>
                  <th scope="col" className="lb__num">
                    Played
                  </th>
                  <th scope="col" className="lb__num">
                    Wins
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.nickname}-${i}`}>
                    <td className="lb__rank data">{i + 1}</td>
                    <td className="lb__player">
                      {r.avatarUrl ? (
                        <img
                          className="lb__avatar"
                          src={r.avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="lb__avatar lb__avatar--ph" aria-hidden="true" />
                      )}
                      <span className="lb__name">{r.nickname}</span>
                    </td>
                    <td className="lb__num data">{r.points}</td>
                    <td className="lb__num data">{r.best}</td>
                    <td className="lb__num data">{r.played}</td>
                    <td className="lb__num data">{r.wins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Screen>
  );
}
