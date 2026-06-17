import { useEffect, useState } from 'react';
import { useGameStore } from './state/gameStore';
import { Screen } from './ui/components/Screen';
import { Eyebrow } from './ui/components/Eyebrow';
import { LoadingScreen } from './ui/screens/LoadingScreen';
import { StartScreen } from './ui/screens/StartScreen';
import { GameScreen } from './ui/screens/GameScreen';

/**
 * Корневой роутер экранов (F3.1). Экран выбирается по состоянию игры из стора:
 *   нет партии        -> Start
 *   phase === 'over'  -> Winner
 *   иначе             -> Game
 * Реальные экраны Start/Game/Winner появляются в F3.2–F3.5; сейчас — плейсхолдеры,
 * чтобы каркас и дизайн-система запускались end-to-end. 3D-сцена вернётся в F4.
 */

type ScreenKind = 'start' | 'game' | 'winner';

/** Временный плейсхолдер экрана — демонстрирует дизайн-токены Auros. */
function Placeholder({ eyebrow, title, note }: { eyebrow: string; title: string; note: string }) {
  return (
    <Screen>
      <div className="placeholder">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="display placeholder__title">{title}</h1>
        <p className="placeholder__note">{note}</p>
      </div>
    </Screen>
  );
}

export function App() {
  const state = useGameStore((s) => s.state);

  // Состояние «загрузка»: вместо пустого экрана — лоадер до первого кадра (в F5 сюда
  // подключится реальная загрузка ассетов 3D/звука).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) return <LoadingScreen />;

  const screen: ScreenKind = !state ? 'start' : state.phase === 'over' ? 'winner' : 'game';

  switch (screen) {
    case 'start':
      return <StartScreen />;
    case 'game':
      return <GameScreen />;
    case 'winner':
      return <Placeholder eyebrow="Game over" title="Winner" note="Winner screen — F3.5" />;
  }
}
