# skeleton (фича в roadmap: Веха 1 → F0. Скелет) — DONE

Последний коммит по фиче: c3c1bdc

Скелет НЕ дробился на под-шаги и НЕ требовал тестов. Цель — «hello world end-to-end»:
Vite + TS + React + R3F поднимаются, на экране 3D-сцена с одним кубиком на «столе» (свет,
тень) и кнопка. Критерий готовности = `npm run dev` поднимает приложение и рисует сцену.

Состав скелета (всё в коммите c3c1bdc):

- [x] Каркас проекта: package.json + зависимости стека (react, three, @react-three/fiber,
      @react-three/drei, vite, typescript, eslint, prettier).
- [x] Конфиги: tsconfig (strict), vite.config, eslint (flat), prettier, index.html.
- [x] Точка входа: src/main.tsx → App.
- [x] 3D-сцена: Canvas (R3F) с освещением, тенью (ContactShadows), «столом», вращающейся
      костью; UI-оверлей с кнопкой Roll поверх.
- [x] Живой запуск: `npm run dev` -> HTTP 200, модули компилируются, лог чист; `npm run build`
      собирается; `npm run lint` чист.

Хвосты / спящие баги (перенесены в roadmap backlog):

- Бандл 965 кБ (Three.js) — разбить на чанки в F6 (полировка).
- 5 npm-уязвимостей в транзитивных dev-зависимостях — проверить/закрыть.
- Грани кости без точек (pips) и без физики — это сознательно, делается в F4.
