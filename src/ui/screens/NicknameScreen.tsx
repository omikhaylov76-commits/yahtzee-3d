import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';
import { NicknameForm } from '../components/NicknameForm';
import { useUiStore } from '../../state/uiStore';
import { useAuthStore } from '../../state/authStore';

/**
 * Экран игрового ника (2.3.e-3, ADR-0015): онбординг по «Play online» (ника ещё нет). Сама форма —
 * переиспользуемый `NicknameForm` (e-5a); этот экран — обёртка с заголовком и навигацией. Смена ника
 * для уже зарегистрированного живёт в кабинете (e-5, inline той же формой). На успех → `nicknameReturn`.
 */
export function NicknameScreen() {
  const isChange = useAuthStore((s) => !!s.user?.nickname);
  const setView = useUiStore((s) => s.setView);
  const nicknameReturn = useUiStore((s) => s.nicknameReturn);

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

        <NicknameForm
          submitLabel={isChange ? 'Save nickname' : 'Continue'}
          autoFocus
          onDone={() => setView(nicknameReturn)}
        />
      </div>
    </Screen>
  );
}
