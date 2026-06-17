import type { Die as DieState } from '../../core';
import { Die } from './Die';

interface DiceProps {
  dice: DieState[];
  canHold: boolean;
  blank: boolean;
  onToggle: (index: number) => void;
}

/** Ряд из 5 костей. */
export function Dice({ dice, canHold, blank, onToggle }: DiceProps) {
  return (
    <div className="dice" role="group" aria-label="Dice">
      {dice.map((d, i) => (
        <Die
          key={i}
          index={i}
          value={d.value}
          held={d.held}
          canHold={canHold}
          blank={blank}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
