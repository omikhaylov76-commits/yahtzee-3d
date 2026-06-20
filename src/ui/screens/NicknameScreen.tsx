import { useState } from 'react';
import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { Button } from '../components/Button';
import { useUiStore } from '../../state/uiStore';
import { useAuthStore, type NickError } from '../../state/authStore';
import { isValidNickname } from '../../../shared/nickname';
import { MAX_NAME_LEN } from '../../../shared/names';

/**
 * Экран игрового ника (2.3.e-3, ADR-0015): придумать (онбординг — ника ещё нет) или сменить (есть ник).
 * Один экран, режим — по `user.nickname`. Ник обязателен для сетевой игры. Валидация мгновенная (общая
 * `isValidNickname`), но ИСТИНА — сервер: он вернёт «занято»/«зарезервировано». Стиль — общий Auros.
 */
const ERROR_TEXT: Record<NickError, string> = {
  invalid: 'Use letters or numbers — up to 20 characters.',
  reserved: 'That nickname is reserved. Try another.',
  taken: 'That nickname is taken. Try another.',
  rate: 'Too many attempts. Try again in a few minutes.',
  auth: 'Your session expired. Sign in again.',
  net: 'Network error. Check your connection and try again.',
};

export function NicknameScreen() {
  const user = useAuthStore((s) => s.user);
  const setNickname = useAuthStore((s) => s.setNickname);
  const setView = useUiStore((s) => s.setView);
  const nicknameReturn = useUiStore((s) => s.nicknameReturn);

  const isChange = !!user?.nickname;
  const [value, setValue] = useState(user?.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<NickError | null>(null);

  const valid = isValidNickname(value);

  const submit = async () => {
    if (!valid || busy) return; // анти-двойной-сабмит + клиентский гейт валидности
    setBusy(true);
    setError(null);
    const res = await setNickname(value);
    if (res.ok) {
      setView(nicknameReturn); // успех → продолжить (online после онбординга / menu после смены)
      return; // экран размонтируется
    }
    setError(res.reason); // поле НЕ сбрасываем — игрок поправит (истина — сервер)
    setBusy(false);
  };

  return (
    <Screen className="coming">
      <div className="online-entry">
        <button type="button" className="back-link" onClick={() => setView('menu')}>
          ← Back to menu
        </button>

        <header className="coming__head online-entry__head">
          <Eyebrow>Account</Eyebrow>
          <h1 className="display coming__title">
            {isChange ? 'Change nickname' : 'Pick a nickname'}
          </h1>
          <p className="coming__sub">
            This is how you appear in online games and on the leaderboard.
          </p>
        </header>

        <form
          className="online-card"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field-label" htmlFor="nickname-input">
            Nickname
          </label>
          <input
            id="nickname-input"
            className="player-row__input"
            type="text"
            value={value}
            maxLength={MAX_NAME_LEN}
            placeholder="e.g. DiceWizard"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-describedby={error ? 'nickname-error' : undefined}
            onChange={(e) => {
              setValue(e.target.value.slice(0, MAX_NAME_LEN));
              if (error) setError(null);
            }}
          />
          {error && (
            <p id="nickname-error" className="field-error" role="alert">
              {ERROR_TEXT[error]}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="online-entry__cta"
            disabled={!valid || busy}
          >
            {busy ? 'Saving…' : isChange ? 'Save nickname' : 'Continue'}
          </Button>
        </form>
      </div>
    </Screen>
  );
}
