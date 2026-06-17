/**
 * Возможности рантайма (F4.5): выбираем 3D-арену или 2D-fallback и уважаем reduced-motion.
 */

/** Доступен ли WebGL. Нет — показываем 2D-кости (а не белый экран). */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

/** Пользователь просит меньше анимаций → показываем статичные 2D-кости (без тумбла). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
