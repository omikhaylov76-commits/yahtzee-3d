import { DieFace } from './DieFace';

interface DieProps {
  index: number;
  value: number;
  held: boolean;
  /** Можно ли сейчас фиксировать (между бросками). */
  canHold: boolean;
  /** Кости ещё не брошены в этом ходу — показать пустую грань. */
  blank: boolean;
  onToggle: (index: number) => void;
}

/** Одна кость-плейсхолдер: клик фиксирует/освобождает (когда это разрешено). */
export function Die({ index, value, held, canHold, blank, onToggle }: DieProps) {
  const interactive = canHold && !blank;
  const cls = ['die', held && 'is-held', !interactive && 'is-static'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-pressed={interactive ? held : undefined}
      aria-disabled={!interactive}
      aria-label={`Die ${index + 1}${blank ? '' : `, value ${value}`}${held ? ', held' : ''}`}
      onClick={() => interactive && onToggle(index)}
    >
      <DieFace value={value} blank={blank} />
      {held && <span className="die__tag">held</span>}
    </button>
  );
}
