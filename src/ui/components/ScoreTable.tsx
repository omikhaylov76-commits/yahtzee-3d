import type { CSSProperties } from 'react';
import { useGameStore } from '../../state/gameStore';
import { CategoryRow } from './CategoryRow';
import { LOWER, UPPER, UPPER_BONUS_THRESHOLD, totalsFor } from '../scoreView';

/** Таблица счёта («манифест»): 13 категорий двумя секциями, колонки игроков, превью, итоги. */
export function ScoreTable() {
  const state = useGameStore((s) => s.state);
  const score = useGameStore((s) => s.score);
  if (!state) return null;

  const style = { '--cols': state.players.length } as CSSProperties;

  return (
    <section className="board score-table" style={style} aria-label="Score sheet">
      {/* Шапка с именами игроков */}
      <div className="srow srow--head" role="row">
        <div className="srow__label" role="columnheader">
          Category
        </div>
        {state.players.map((p, i) => (
          <div
            key={i}
            className={`scell scell--name${i === state.current ? ' is-current' : ''}`}
            role="columnheader"
          >
            {i === state.current && <span className="pip pip--on scell__turn" aria-hidden="true" />}
            <span className="scell__name-text">{p.name}</span>
          </div>
        ))}
      </div>

      <div className="srow srow--section" role="row">
        <div className="srow__label" role="rowheader">
          Upper
        </div>
      </div>
      {UPPER.map((c) => (
        <CategoryRow key={c} state={state} category={c} onScore={score} />
      ))}

      {/* Верхний бонус: прогресс до порога или начисленные +35 */}
      <div className="srow srow--bonus" role="row">
        <div className="srow__label" role="rowheader">
          Bonus (at {UPPER_BONUS_THRESHOLD})
        </div>
        {state.players.map((p, i) => {
          const t = totalsFor(p);
          return (
            <div
              key={i}
              className={`scell data${i === state.current ? ' is-current' : ''}`}
              role="cell"
            >
              {t.bonus > 0 ? `+${t.bonus}` : `${t.upper}/${UPPER_BONUS_THRESHOLD}`}
            </div>
          );
        })}
      </div>

      <div className="srow srow--section" role="row">
        <div className="srow__label" role="rowheader">
          Lower
        </div>
      </div>
      {LOWER.map((c) => (
        <CategoryRow key={c} state={state} category={c} onScore={score} />
      ))}

      {/* Бонусные Yahtzee */}
      <div className="srow srow--bonus" role="row">
        <div className="srow__label" role="rowheader">
          Yahtzee bonus
        </div>
        {state.players.map((p, i) => {
          const t = totalsFor(p);
          return (
            <div
              key={i}
              className={`scell data${i === state.current ? ' is-current' : ''}${t.yahtzeeBonus ? ' is-filled' : ''}`}
              role="cell"
            >
              {t.yahtzeeBonus ? `+${t.yahtzeeBonus}` : '·'}
            </div>
          );
        })}
      </div>

      {/* Итог */}
      <div className="srow srow--total" role="row">
        <div className="srow__label" role="rowheader">
          Total
        </div>
        {state.players.map((p, i) => (
          <div
            key={i}
            className={`scell data scell--total${i === state.current ? ' is-current' : ''}`}
            role="cell"
          >
            {totalsFor(p).total}
          </div>
        ))}
      </div>
    </section>
  );
}
