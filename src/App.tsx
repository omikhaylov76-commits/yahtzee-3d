import { Scene } from './scene/Scene';

/**
 * Скелет F0: 3D-сцена на весь экран + поверх неё минимальный UI (заголовок и кнопка).
 * Это «hello world end-to-end» — проверка, что весь стек (Vite+React+R3F) поднимается.
 * Реальные экраны/таблица счёта появятся в фичах F3+.
 */
export function App() {
  return (
    <div className="app">
      <Scene />
      <div className="overlay">
        <p className="eyebrow">Yahtzee 3D</p>
        <h1 className="title">Skeleton</h1>
        <button
          className="btn-primary"
          type="button"
          onClick={() => console.log('Roll (заглушка)')}
        >
          Roll
        </button>
      </div>
    </div>
  );
}
