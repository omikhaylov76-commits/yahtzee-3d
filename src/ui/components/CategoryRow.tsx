import type { Category, GameState } from '../../core';
import type { CellFlash } from './ScoreTable';
import { CategoryGlyph } from './CategoryGlyph';
import { CATEGORY_LABELS, previewFor, recorded } from '../scoreView';

interface CategoryRowProps {
  state: GameState;
  category: Category;
  onScore: (category: Category) => void;
  /** Ячейка, которую только что записали — для пульса (F6.1). */
  flash?: CellFlash | null;
  /** Свободные категории с максимумом очков — мягкий акцент «лучший вариант» (F6.5). */
  best?: Set<Category>;
}

/** Строка категории: подпись + ячейка на игрока. У активного игрока свободная ячейка —
 *  кликабельное превью очков; заполненная показывает записанное; чужие/недоступные — точка. */
export function CategoryRow({ state, category, onScore, flash, best }: CategoryRowProps) {
  const preview = previewFor(state, category);
  const label = CATEGORY_LABELS[category];

  return (
    <div className="srow" role="row">
      <div className="srow__label" role="rowheader">
        <CategoryGlyph category={category} />
        <span className="srow__label-text">{label}</span>
      </div>
      {state.players.map((player, i) => {
        const isCurrent = i === state.current;
        const value = recorded(player, category);
        const cls = `scell data${isCurrent ? ' is-current' : ''}`;

        if (value !== undefined) {
          const justScored = flash?.player === i && flash?.category === category;
          return (
            <div
              key={i}
              className={`${cls} is-filled${justScored ? ' is-justscored' : ''}`}
              role="cell"
            >
              {value}
            </div>
          );
        }
        if (isCurrent && preview !== null) {
          // F6.5: нули — тускло (is-zero), самый выгодный вариант — мягкий акцент (is-best).
          const isZero = preview === 0;
          const isBest = !isZero && best?.has(category) === true;
          const previewCls = `${cls} scell--preview${isZero ? ' is-zero' : ''}${
            isBest ? ' is-best' : ''
          }`;
          return (
            <button
              key={i}
              type="button"
              className={previewCls}
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
