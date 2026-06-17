import type { ReactNode } from 'react';

/** Метка-надзаголовок с фирменной светящейся точкой-pip (мотив Auros). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}
