const MAX_ROLLS = 3;

/** Счётчик бросков в виде трёх точек-pip: заполнены = израсходованы. */
export function RollCounter({ rollsLeft }: { rollsLeft: number }) {
  const used = MAX_ROLLS - rollsLeft;
  return (
    <div className="roll-counter" aria-label={`Rolls used: ${used} of ${MAX_ROLLS}`}>
      {Array.from({ length: MAX_ROLLS }, (_, i) => (
        <span key={i} className={`pip${i < used ? ' pip--on' : ''}`} />
      ))}
    </div>
  );
}
