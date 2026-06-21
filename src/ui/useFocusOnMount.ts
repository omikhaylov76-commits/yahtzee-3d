import { useEffect, useRef } from 'react';

/**
 * a11y (2.4.d): при маунте экрана перевести фокус на переданный элемент (обычно заголовок
 * `<h1 tabIndex={-1}>` или контейнер с aria-label). Иначе при смене сетевых экранов
 * (menu→online→tables→lobby) клавиатура/скринридер «проваливаются» на `<body>` и теряют контекст —
 * а так пользователь слышит имя нового экрана. Срабатывает один раз на маунт; `preventScroll` —
 * чтобы фокус не дёргал прокрутку. Кольцо на программном фокусе гасит CSS `[tabindex='-1']:focus`.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}
