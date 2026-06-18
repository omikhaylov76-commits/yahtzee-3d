/**
 * Прототип F8: иконки игровых кнопок в пип-мотиве Auros. currentColor — наследуют цвет текста
 * кнопки (тёмный на градиенте Roll, светлый на вторичной Nudge).
 */

/** Кубик-грань (5 точек) — для Roll. */
export function RollDieIcon() {
  return (
    <svg className="btn__icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <g fill="currentColor">
        <circle cx="5.6" cy="5.6" r="1" />
        <circle cx="10.4" cy="5.6" r="1" />
        <circle cx="8" cy="8" r="1" />
        <circle cx="5.6" cy="10.4" r="1" />
        <circle cx="10.4" cy="10.4" r="1" />
      </g>
    </svg>
  );
}

/** Кубик + «штрихи тряски» — для Nudge (трясём стол). */
export function ShakeDieIcon() {
  return (
    <svg className="btn__icon btn__icon--wide" viewBox="0 0 18 16" aria-hidden="true">
      <rect
        x="2"
        y="3.4"
        width="9"
        height="9"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <g fill="currentColor">
        <circle cx="4.8" cy="6.2" r="0.95" />
        <circle cx="8.2" cy="9.8" r="0.95" />
      </g>
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M13.3 5.4 q1.6 2.6 0 5.2" strokeWidth="1.2" />
        <path d="M15.6 4 q2.1 4 0 8" strokeWidth="1.1" opacity="0.65" />
      </g>
    </svg>
  );
}
