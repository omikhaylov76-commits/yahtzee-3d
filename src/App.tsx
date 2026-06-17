import { useEffect, useState } from 'react';
import { useGameStore } from './state/gameStore';
import { eventToSound, soundEngine } from './sound';
import { SoundControl } from './ui/components/SoundControl';
import { Celebration } from './ui/components/Celebration';
import { LoadingScreen } from './ui/screens/LoadingScreen';
import { StartScreen } from './ui/screens/StartScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { WinnerScreen } from './ui/screens/WinnerScreen';

/**
 * Корневой роутер экранов + глобальный звуковой мост (F5). Экран выбирается по состоянию игры:
 *   нет партии -> Start, phase === 'over' -> Winner, иначе -> Game.
 */
export function App() {
  const state = useGameStore((s) => s.state);
  const events = useGameStore((s) => s.events);
  const muted = useGameStore((s) => s.muted);
  const volume = useGameStore((s) => s.volume);
  const ambient = useGameStore((s) => s.ambient);

  // Звук (F5): применяем настройки и проигрываем по доменным событиям ядра.
  useEffect(() => soundEngine.setMuted(muted), [muted]);
  useEffect(() => soundEngine.setVolume(volume), [volume]);
  useEffect(() => {
    if (ambient) soundEngine.startAmbient();
    else soundEngine.stopAmbient();
  }, [ambient]);
  useEffect(() => {
    for (const e of events) {
      const snd = eventToSound(e);
      if (snd) soundEngine.play(snd);
    }
  }, [events]);
  // Разблокировать AudioContext по первому жесту (политика автоплея браузеров).
  useEffect(() => {
    const unlock = () => soundEngine.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Состояние «загрузка»: лоадер до первого кадра (в F5+ — реальная загрузка ассетов).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const screen = !ready ? (
    <LoadingScreen />
  ) : !state ? (
    <StartScreen />
  ) : state.phase === 'over' ? (
    <WinnerScreen />
  ) : (
    <GameScreen />
  );

  return (
    <>
      {screen}
      <SoundControl />
      <Celebration />
    </>
  );
}
