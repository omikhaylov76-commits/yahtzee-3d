import { useEffect, useState } from 'react';
import { useGameStore } from './state/gameStore';
import { LoadingScreen } from './ui/screens/LoadingScreen';
import { StartScreen } from './ui/screens/StartScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { WinnerScreen } from './ui/screens/WinnerScreen';

/**
 * Корневой роутер экранов. Экран выбирается по состоянию игры из стора:
 *   нет партии        -> Start
 *   phase === 'over'  -> Winner
 *   иначе             -> Game
 * 3D-сцена вернётся в игровой экран в F4.
 */

type ScreenKind = 'start' | 'game' | 'winner';

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
      return <WinnerScreen />;
  }
}
