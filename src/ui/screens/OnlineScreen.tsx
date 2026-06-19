import { useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useGameStore } from '../../state/gameStore';
import type { OnlineStatus } from '../../platform/net';

/**
 * Экран входа в онлайн (2.2.a-2): создать комнату (код выдаст сервер) или войти по коду друга.
 * Пока режим `local` — показываем форму; после `goOnline` (mode `online`) — статус соединения/ошибки.
 * Когда от сервера приходит состав лобби, роутер показывает `LobbyScreen` (этот экран размонтируется).
 * Имя — опциональное; сервер чистит его (`cleanName`), полная валидация — 2.2.b. Дизайн — a-3.
 */
const STATUS_LABEL: Record<OnlineStatus, string> = {
  connecting: 'Connecting…',
  offline: 'Server is offline — try again later',
  mismatch: 'Version mismatch — please refresh the page',
  notFound: 'Room not found — check the code and try again',
  full: 'That room is full',
  alreadyStarted: 'That game has already started',
  waiting: 'Joining room…',
  playing: 'Starting…',
};

const MAX_NAME = 20;
const CODE_LEN = 6;

export function OnlineScreen() {
  const setView = useUiStore((s) => s.setView);
  const goOnline = useGameStore((s) => s.goOnline);
  const goLocal = useGameStore((s) => s.goLocal);
  const mode = useGameStore((s) => s.mode);
  const status = useGameStore((s) => s.onlineStatus) ?? 'connecting';
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const trimmedName = () => name.trim() || undefined;
  const create = () => goOnline({ type: 'create', name: trimmedName() });
  const join = () => {
    const c = code.trim();
    if (c) goOnline({ type: 'join', code: c, name: trimmedName() });
  };
  const backToMenu = () => {
    goLocal();
    setView('menu');
  };

  // Подключаемся / ошибка входа: показываем статус. Лобби (успех) роутер покажет сам.
  if (mode === 'online') {
    // Исправимые ошибки (опечатка в коде, занято, уже идёт, сервер недоступен) — даём «Try again»:
    // `goLocal` гасит мёртвую сессию и возвращает к форме (mode→local), а введённые код/имя в стейте
    // сохранены. (mismatch не сюда — там нужен refresh страницы.)
    const retryable =
      status === 'offline' ||
      status === 'notFound' ||
      status === 'full' ||
      status === 'alreadyStarted';
    return (
      <Screen className="coming">
        <div className="coming__inner">
          <header className="coming__head">
            <Eyebrow>Online</Eyebrow>
            <h1 className="display coming__title">Play online</h1>
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

  // Форма входа (mode local): создать комнату или войти по коду.
  return (
    <Screen className="coming">
      <div className="online-entry">
        <button type="button" className="back-link" onClick={() => setView('menu')}>
          ← Back to menu
        </button>

        <header className="coming__head">
          <Eyebrow>Online</Eyebrow>
          <h1 className="display coming__title">Play online</h1>
          <p className="coming__sub">
            Create a room and share the code, or join a friend&apos;s room.
          </p>
        </header>

        <section className="start__panel">
          <label className="field-label" htmlFor="online-name">
            Your name <span className="field-opt">(optional)</span>
          </label>
          <input
            id="online-name"
            className="player-row__input"
            type="text"
            value={name}
            maxLength={MAX_NAME}
            placeholder="Player"
            onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
          />
        </section>

        <div className="online-entry__create">
          <Button variant="primary" className="online-entry__cta" onClick={create}>
            Create room
          </Button>
        </div>

        <div className="online-entry__or" aria-hidden="true">
          or
        </div>

        <section className="start__panel">
          <label className="field-label" htmlFor="online-code">
            Room code
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
        </section>
      </div>
    </Screen>
  );
}
