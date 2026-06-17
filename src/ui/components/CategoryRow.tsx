import type { Category, GameState } from '../../core';
import { CATEGORY_LABELS, previewFor, recorded } from '../scoreView';

interface CategoryRowProps {
  state: GameState;
  category: Category;
  onScore: (category: Category) => void;
}

/** Строка категории: подпись + ячейка на игрока. У активного игрока свободная ячейка —
 *  кликабельное превью очков; заполненная показывает записанное; чужие/недоступные — точка. */
export function CategoryRow({ state, category, onScore }: CategoryRowProps) {
  const preview = previewFor(state, category);
  const label = CATEGORY_LABELS[category];

  return (
    <div className="srow" role="row">
      <div className="srow__label" role="rowheader">
        {label}
      </div>
      {state.players.map((player, i) => {
        const isCurrent = i === state.current;
        const value = recorded(player, category);
        const cls = `scell data${isCurrent ? ' is-current' : ''}`;

        if (value !== undefined) {
          return (
            <div key={i} className={`${cls} is-filled`} role="cell">
              {value}
            </div>
          );
        }
        if (isCurrent && preview !== null) {
          return (
            <button
              key={i}
              type="button"
              className={`${cls} scell--preview`}
              role="cell"
              aria-label={`Score ${label}: ${preview}`}
              onClick={() => onScore(category)}
            >
              {preview}
            </button>
          );
        }
        return (
          <div key={i} className={cls} role="cell" aria-hidden="true">
            ·
          </div>
        );
      })}
    </div>
  );
}
