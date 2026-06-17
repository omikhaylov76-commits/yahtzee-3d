import type { ReactNode } from 'react';

/** Оболочка экрана на всю высоту вьюпорта. */
export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`screen ${className}`.trim()}>{children}</main>;
}
