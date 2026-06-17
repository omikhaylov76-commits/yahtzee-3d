# skeleton (фича в roadmap: Веха 1 → F0. Скелет)

Последний коммит по фиче: нет
Файлы под-шага (тронем): package.json, tsconfig.json, vite.config.ts, index.html,
.eslintrc / eslint.config, .prettierrc, src/main.tsx, src/App.tsx, src/scene/Scene.tsx,
src/styles.css, .env.example (нет — чистый фронт), README (нет)

Скелет НЕ дробится на под-шаги и НЕ требует тестов. Цель — «hello world end-to-end»:
Vite + TS + React + R3F поднимаются, на экране 3D-сцена с одним кубиком на «столе» (свет,
тень) и кнопка. Критерий готовности = `npm run dev` поднимает приложение и оно рисует сцену.

Состав скелета:

- [~] Каркас проекта: package.json + зависимости стека (react, three, @react-three/fiber,
  @react-three/drei, vite, typescript, eslint, prettier).
- [~] Конфиги: tsconfig, vite.config, eslint, prettier, index.html.
- [~] Точка входа: src/main.tsx → App.
- [~] 3D-сцена: Canvas (R3F) с освещением, тенью, «столом» и одним кубиком; кнопка поверх.
- [ ] Живой запуск: `npm run dev` поднимается, сцена видна; `npm run build` собирается.

Хвосты / спящие баги: нет
