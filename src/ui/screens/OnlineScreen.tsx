import { useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useAuthStore } from '../../state/authStore';
import { useGameStore } from '../../state/gameStore';
import type { OnlineStatus } from '../../platform/net';
import { normalizeName, MAX_NAME_LEN } from '../../../shared/names';
import { roomCodeFromUrl } from '../../platform/deepLink';
import { useFocusOnMount } from '../useFocusOnMount';

/**
 * Экран входа в онлайн (2.2.a-2 → полировка a-3): создать комнату (код выдаст сервер) или войти по
 * коду друга. Пока режим `local` — форма с двумя путями; после `goOnline` (mode `online`) — статус
 * соединения/ошибки. Когда приходит состав лобби, роутер показывает `LobbyScreen` (этот размонтируется).
 * Имя опционально (сервер чистит его; полная валидация — 2.2.b).
 */
const STATUS_LABEL: Record<OnlineStatus, string> = {
  connecting: 'Connecting…',
  offline: 'Server is offline. Try again in a moment.',
  mismatch: 'New version available. Refresh the page to play.',
  notFound: 'No room with that code. Check it and try again.',
  full: 'That room is full.',
  serverBusy: 'Server is busy right now. Try again in a moment.',
  alreadyStarted: 'That game has already started.',
  kicked: 'The host removed you from the room.',
  gone: 'This game has ended.',
  waiting: 'Joining room…',
  playing: 'Starting…',
};

const CODE_LEN = 6;

export function OnlineScreen() {
  const setView = useUiStore((s) => s.setView);
  const setNicknameReturn = useUiStore((s) => s.setNicknameReturn);
  const user = useAuthStore((s) => s.user);
  const goOnline = useGameStore((s) => s.goOnline);
  const goLocal = useGameStore((s) => s.goLocal);
  const mode = useGameStore((s) => s.mode);
  const status = useGameStore((s) => s.onlineStatus) ?? 'connecting';
  const headingRef = useFocusOnMount<HTMLHeadingElement>(); // a11y (2.4.d): фокус на заголовок при маунте
  const [name, setName] = useState('');
  // Пришли по ссылке-приглашению `?room=CODE`? Захватываем код ОДИН раз (URL не меняется за жизнь экрана):
  // по нему показываем УЗКИЙ экран join (2.2.d-1) вместо полной формы create/join. Поле кода — из него же.
  const [invitedCode] = useState(() => roomCodeFromUrl());
  const [code, setCode] = useState(() => invitedCode ?? '');
  const [override, setOverride] = useState(false); // гость нажал «другой код / создать» → полная форма
  const [open, setOpen] = useState(false); // создать ОТКРЫТЫЙ стол (в списке, вход без кода) — 2.5.d
  const [title, setTitle] = useState('');

  // Чистим имя тем же общим фильтром, что и сервер (shared/names); серверная очистка всё равно финальна.
  const cleanedName = () => normalizeName(name) || undefined;
  // Гейт ника (2.3.e-3b): залогиненному без ника — сперва онбординг (вернёмся в online). Покрывает и
  // deep-link `?room=` (этот экран — единственная точка create/join). Сервер всё равно страхует (e-2b).
  const needsNick = () => {
    if (user && !user.nickname) {
      setNicknameReturn('online');
      setView('nickname');
      return true;
    }
    return false;
  };
  const create = () => {
    if (needsNick()) return;
    goOnline({
      type: 'create',
      name: cleanedName(),
      open,
      title: open ? title.trim() || undefined : undefined,
    });
  };
  const join = () => {
    if (needsNick()) return;
    const c = code.trim();
    if (c) goOnline({ type: 'join', code: c, name: cleanedName() });
  };
  const backToMenu = () => {
    goLocal();
    setView('menu');
  };

  // Подключаемся / ошибка входа: показываем статус. Лобби (успех) роутер покажет сам.
  if (mode === 'online') {
    // Исправимые ошибки (опечатка, занято, идёт, сервер недоступен/занят) — даём «Try again»:
    // `goLocal` гасит мёртвую сессию и возвращает к форме (mode→local), а код/имя в стейте сохранены.
    // (mismatch не сюда — там нужен refresh страницы.)
    const retryable =
      status === 'offline' ||
      status === 'notFound' ||
      status === 'full' ||
      status === 'serverBusy' ||
      status === 'alreadyStarted' ||
      status === 'kicked' ||
      status === 'gone';
    return (
      <Screen className="coming">
        <div className="coming__inner">
          <header className="coming__head">
            <Eyebrow>Online</Eyebrow>
            <h1 className="display coming__title" ref={headingRef} tabIndex={-1}>
              Play online
            </h1>
          </header>
          <p className={`conn-status conn-status--${status}`} role="status" aria-live="polite">
            {STATUS_LABEL[status]}
          </p>
          <div className="coming__actions">
            {retryable && (
              <Button variant="primary" onClick={() => goLocal()}>
                Try again
              </Button>
            )}
            <Button variant="ghost" onClick={backToMenu}>
              ← Back to menu
            </Button>
          </div>
        </div>
      </Screen>
    );
  }

  // Пришли по приглашению (2.2.d-1): узкий экран «Join» — код подставлен, один тап. Полную форму
  // (создать / другой код) гость открывает ссылкой «Use a different code…» (override). Блок статуса/ошибки
  // выше — общий; «Try again» (goLocal) вернёт сюда же, т.к. код всё ещё в URL.
  if (invitedCode != null && !override) {
    return (
      <Screen className="coming">
        <div className="online-entry">
          <button type="button" className="back-link" onClick={() => setView('menu')}>
            ← Back to menu
          </button>

          <header className="coming__head online-entry__head">
            <Eyebrow>Online · invite</Eyebrow>
            <h1 className="display coming__title" ref={headingRef} tabIndex={-1}>
              Join the room
            </h1>
            <p className="coming__sub">You&rsquo;ve been invited. Add your name and jump in.</p>
          </header>

          <div className="online-field">
            <label className="field-label" htmlFor="online-name">
              Your name <span className="field-opt">optional</span>
            </label>
            <input
              id="online-name"
              className="player-row__input"
              type="text"
              value={name}
              maxLength={MAX_NAME_LEN}
              placeholder="Player"
              onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LEN))}
            />
          </div>

          <div className="online-card">
            <label className="field-label" htmlFor="online-code">
              Room code
            </label>
            <input
              id="online-code"
              className="player-row__input online-code-input online-code-input--hero"
              type="text"
              value={code}
              maxLength={CODE_LEN}
              placeholder="K7Q9ZP"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Room code"
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, CODE_LEN))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  join();
                }
              }}
            />
            <Button
              variant="primary"
              className="online-entry__cta"
              onClick={join}
              disabled={!code.trim()}
            >
              Join room
            </Button>
          </div>

          <button type="button" className="online-entry__alt" onClick={() => setOverride(true)}>
            Use a different code or create a room
          </button>
        </div>
      </Screen>
    );
  }

  // Форма входа (mode local): создать комнату или войти по коду.
  return (
    <Screen className="coming">
      <div className="online-entry">
        <button type="button" className="back-link" onClick={() => setView('menu')}>
          ← Back to menu
        </button>

        <header className="coming__head online-entry__head">
          <Eyebrow>Online</Eyebrow>
          <h1 className="display coming__title" ref={headingRef} tabIndex={-1}>
            Play online
          </h1>
          <p className="coming__sub">Start a table and share the code, or join a friend by code.</p>
        </header>

        <button type="button" className="tables-entry" onClick={() => setView('tables')}>
          <span className="online-card__title">Browse open tables</span>
          <span className="online-card__desc">
            See who&rsquo;s playing now — join without a code.
          </span>
        </button>

        <div className="online-field">
          <label className="field-label" htmlFor="online-name">
            Your name <span className="field-opt">optional</span>
          </label>
          <input
            id="online-name"
            className="player-row__input"
            type="text"
            value={name}
            maxLength={MAX_NAME_LEN}
            placeholder="Player"
            onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LEN))}
          />
        </div>

        <div className="online-card">
          <div className="online-card__text">
            <span className="online-card__title">Create a room</span>
            <span className="online-card__desc">
              Private — share a code. Open — anyone joins from the list.
            </span>
          </div>
          <div className="count-seg seg-2" role="group" aria-label="Room visibility">
            <button
              type="button"
              className={`count-seg__btn${!open ? ' is-active' : ''}`}
              aria-pressed={!open}
              onClick={() => setOpen(false)}
            >
              Private
            </button>
            <button
              type="button"
              className={`count-seg__btn${open ? ' is-active' : ''}`}
              aria-pressed={open}
              onClick={() => setOpen(true)}
            >
              Open
            </button>
          </div>
          {open && (
            <input
              className="player-row__input"
              type="text"
              value={title}
              maxLength={24}
              placeholder="Table name (optional)"
              aria-label="Table name"
              onChange={(e) => setTitle(e.target.value.slice(0, 24))}
            />
          )}
          <Button variant="primary" className="online-entry__cta" onClick={create}>
            {open ? 'Create open table' : 'Create room'}
          </Button>
        </div>

        <div className="online-entry__or" aria-hidden="true">
          or
        </div>

        <div className="online-card">
          <label className="field-label" htmlFor="online-code">
            Join with a code
          </label>
          <div className="online-join">
            <input
              id="online-code"
              className="player-row__input online-code-input"
              type="text"
              value={code}
              maxLength={CODE_LEN}
              placeholder="K7Q9ZP"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Room code"
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, CODE_LEN))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  join();
                }
              }}
            />
            <Button onClick={join} disabled={!code.trim()}>
              Join
            </Button>
          </div>
        </div>
      </div>
    </Screen>
  );
}
