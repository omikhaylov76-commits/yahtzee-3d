import { useGameStore } from '../../state/gameStore';

/** Компактный контрол звука (F5): вкл/выкл + громкость. Глобальный, в углу экрана. */
export function SoundControl() {
  const muted = useGameStore((s) => s.muted);
  const volume = useGameStore((s) => s.volume);
  const setMuted = useGameStore((s) => s.setMuted);
  const setVolume = useGameStore((s) => s.setVolume);

  return (
    <div className="sound-control" role="group" aria-label="Sound">
      <button
        type="button"
        className="sound-control__btn"
        aria-pressed={muted}
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={() => setMuted(!muted)}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <input
        className="sound-control__range"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        aria-label="Volume"
        onChange={(e) => {
          const v = Number(e.target.value);
          setVolume(v);
          if (muted && v > 0) setMuted(false);
        }}
      />
    </div>
  );
}
