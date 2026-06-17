import { Screen } from '../components/Screen';
import { Eyebrow } from '../components/Eyebrow';

/** Экран загрузки: вместо пустого чёрного экрана — фирменная точка и подпись. */
export function LoadingScreen() {
  return (
    <Screen className="loading-screen">
      <div className="loading-screen__center">
        <Eyebrow>Yahtzee 3D</Eyebrow>
        <p className="loading-screen__text data">loading…</p>
      </div>
    </Screen>
  );
}
