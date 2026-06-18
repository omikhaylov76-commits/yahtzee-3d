import { Component, type ReactNode } from 'react';

interface Props {
  /** Что показать, если дети упали (напр. 2D-кости вместо 3D-арены). */
  fallback: ReactNode;
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Простой Error Boundary (F6.4). Если ленивый 3D-чанк не загрузится (оффлайн при первом
 * заходе, протухший хеш чанка после деплоя) или арена упадёт в рантайме — показываем
 * запасной контент (2D-кости), а не белый экран. В духе F4.5: деградация в 2D вместо краша.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Деградация ожидаема; оставляем след для отладки, но не валим приложение.
    console.warn('3D arena failed; falling back to 2D dice:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
