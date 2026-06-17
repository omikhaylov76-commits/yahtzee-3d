import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Category } from '../../core';
import { useGameStore } from '../../state/gameStore';
import { CategoryRow } from './CategoryRow';
import { LOWER, UPPER, UPPER_BONUS_THRESHOLD, totalsFor } from '../scoreView';

/** Какую ячейку «подсветить» при записи очков (F6.1) — событийно из ядра. */
export interface CellFlash {
  player: number;
  category: Category;
  key: number;
}

/** Длительность подсветки, мс. Должна быть ≥ длительности cell-pop/turn-glow в theme.css
 *  (0.6s), иначе класс снимется до конца анимации и она «моргнёт». */
const FLASH_MS = 700;

/** Таблица счёта («манифест»): 13 категорий двумя секциями, колонки игроков, превью, итоги. */
export function ScoreTable() {
  const state = useGameStore((s) => s.state);
  const score = useGameStore((s) => s.score);
  const events = useGameStore((s) => s.events);

  // F6.1 микроанимации: реагируем на доменные события ядра, в правила не лезем.
  // Пульс ячейки при записи очков.
  const [flash, setFlash] = useState<CellFlash | null>(null);
  const flashNonce = useRef(0);
  useEffect(() => {
    // За один ход ядро пишет ровно одно score:written; берём последнее в батче на всякий случай.
    const written = [...events].reverse().find((e) => e.type === 'score:written');
    if (written && written.type === 'score:written') {
      flashNonce.current += 1;
      const key = flashNonce.current;
      setFlash({ player: written.player, category: written.category, key });
      const t = setTimeout(() => setFlash((f) => (f?.key === key ? null : f)), FLASH_MS);
      return () => clearTimeout(t);
    }
  }, [events]);

  // Тёплый glow имени при переходе хода к новому игроку.
  const [turnFlash, setTurnFlash] = useState<number | null>(null);
  useEffect(() => {
    const turned = [...events].reverse().find((e) => e.type === 'turn:changed');
    if (turned && turned.type === 'turn:changed') {
      setTurnFlash(turned.player);
      const t = setTimeout(() => setTurnFlash(null), FLASH_MS);
      return () => clearTimeout(t);
    }
  }, [events]);

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
            className={`scell scell--name${i === state.current ? ' is-current' : ''}${
              turnFlash === i ? ' is-turnflash' : ''
            }`}
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
        <CategoryRow key={c} state={state} category={c} onScore={score} flash={flash} />
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
        <CategoryRow key={c} state={state} category={c} onScore={score} flash={flash} />
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
