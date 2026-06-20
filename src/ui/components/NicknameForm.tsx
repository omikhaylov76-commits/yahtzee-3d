import { useState } from 'react';
import { Button } from './Button';
import { useAuthStore, type NickError } from '../../state/authStore';
import { isValidNickname } from '../../../shared/nickname';
import { MAX_NAME_LEN } from '../../../shared/names';

/**
 * Переиспользуемая форма игрового ника (2.3.e-5a, ADR-0015): поле + клиентская валидация (общая
 * `isValidNickname`, мгновенный фидбэк) + сохранение через `authStore.setNickname` + состояния
 * ошибок/занятости. Истина — сервер (taken/reserved/...). Используется онбордингом (NicknameScreen,
 * отдельный экран) и кабинетом (inline-секция) — один источник UX ника.
 */
const ERROR_TEXT: Record<NickError, string> = {
  invalid: 'Use 2–20 characters (letters or numbers).',
  reserved: 'That nickname is reserved. Try another.',
  taken: 'That nickname is taken. Try another.',
  rate: 'Too many attempts. Try again in a few minutes.',
  auth: 'Your session expired. Sign in again.',
  net: 'Network error. Check your connection and try again.',
};

interface NicknameFormProps {
  /** Подпись кнопки в контексте: онбординг — «Continue», смена в кабинете — «Save nickname». */
  submitLabel: string;
  /** Автофокус поля — для отдельного экрана-онбординга; в кабинете false (не красть фокус при открытии). */
  autoFocus?: boolean;
  /** Вызывается ПОСЛЕ успешного сохранения (навигация/обновление — на вызывающем). */
  onDone: () => void;
}

export function NicknameForm({ submitLabel, autoFocus = false, onDone }: NicknameFormProps) {
  const nickname = useAuthStore((s) => s.user?.nickname ?? null);
  const setNickname = useAuthStore((s) => s.setNickname);
  const [value, setValue] = useState(nickname ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<NickError | null>(null);
  const valid = isValidNickname(value);

  const submit = async () => {
    if (!valid || busy) return; // анти-двойной-сабмит + клиентский гейт валидности
    setBusy(true);
    setError(null);
    const res = await setNickname(value);
    setBusy(false);
    if (res.ok) {
      onDone();
      return;
    }
    setError(res.reason); // поле НЕ сбрасываем — игрок поправит (истина — сервер)
  };

  return (
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
        autoFocus={autoFocus}
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
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
