import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useGameStore } from '../../state/gameStore';
import { useAuthStore } from '../../state/authStore';
import { useOpenTables } from '../../state/openTables';
import type { OpenTable } from '../../../shared/protocol';
import { useFocusOnMount } from '../useFocusOnMount';

/**
 * Экран публичного списка открытых/дежурных столов (2.5.d-2, ADR-0017): опрашивает `GET /tables`,
 * рисует столы (название · занято/всего · статус) на компонентах Auros; клик по свободному столу —
 * вход без кода (`joinOpen`). Состояния загрузка/ошибка/пусто. Имён игроков в списке нет (приватность).
 */
const STATUS_TEXT: Record<OpenTable['status'], string> = {
  waiting: 'Waiting',
  'in-game': 'In game',
  full: 'Full',
};

export function TablesScreen() {
  const setView = useUiStore((s) => s.setView);
  const setNicknameReturn = useUiStore((s) => s.setNicknameReturn);
  const user = useAuthStore((s) => s.user);
  const goOnline = useGameStore((s) => s.goOnline);
  const { tables, status, refresh } = useOpenTables();
  const headingRef = useFocusOnMount<HTMLHeadingElement>(); // a11y (2.4.d): фокус на заголовок при маунте

  const join = (t: OpenTable) => {
    if (t.status !== 'waiting') return; // полный / идёт партия — вход закрыт (зрителей нет)
    // Гейт ника (ADR-0015): залогиненный без ника — сперва онбординг (вернёмся в онлайн). Сервер страхует.
    if (user && !user.nickname) {
      setNicknameReturn('online');
      setView('nickname');
      return;
    }
    goOnline({ type: 'joinOpen', tableId: t.tableId });
  };

  return (
    <Screen className="coming">
      <div className="online-entry">
        <button type="button" className="back-link" onClick={() => setView('menu')}>
          ← Back to menu
        </button>

        <header className="coming__head online-entry__head">
          <Eyebrow>Online · tables</Eyebrow>
          <h1 className="display coming__title" ref={headingRef} tabIndex={-1}>
            Open tables
          </h1>
          <p className="coming__sub">Jump into any table with a free seat.</p>
        </header>

        {status === 'loading' && (
          <p className="tables__msg" role="status" aria-busy="true">
            Loading tables…
          </p>
        )}

        {status === 'error' && (
          <div className="tables__msg" role="status">
            <span className="conn-status conn-status--offline">Couldn&rsquo;t load tables.</span>
            <Button onClick={refresh}>Try again</Button>
          </div>
        )}

        {status === 'ready' && tables.length === 0 && (
          <p className="tables__msg">No open tables right now — create one below.</p>
        )}

        {status === 'ready' && tables.length > 0 && (
          <ul className="tables-list" aria-label="Open tables">
            {tables.map((t) => {
              const joinable = t.status === 'waiting';
              return (
                <li key={t.tableId}>
                  <button
                    type="button"
                    className={`table-row${joinable ? '' : ' is-disabled'}`}
                    onClick={() => join(t)}
                    disabled={!joinable}
                  >
                    <span className="table-row__name">{t.title}</span>
                    <span className="table-row__seats data">
                      {t.count}/{t.capacity}
                    </span>
                    <span className={`conn-status conn-status--${joinable ? 'waiting' : 'ingame'}`}>
                      {STATUS_TEXT[t.status]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Button variant="primary" className="online-entry__cta" onClick={() => setView('online')}>
          + Create a table
        </Button>
      </div>
    </Screen>
  );
}
