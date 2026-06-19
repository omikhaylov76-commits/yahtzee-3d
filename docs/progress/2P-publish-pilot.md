# 2P-publish-pilot (фича в roadmap: Веха 2 → «2.P Публикация гостевого пилота»)

Последний коммит по фиче: 1f97cab (2.P.2)
Файлы под-шага (тронем):

- `package.json` + `package-lock.json` (новая зависимость `@fastify/static@^9`)
- `server/index.ts` (раздача статики + SPA-fallback + маршрут `/status`)
- `server/platform/realtime.ts` (сигнатура `attachRealtime` → `{ io, getStatus }`)
- `src/platform/net.ts` (dev/prod-развилка адреса сервера)
- `railway.json` (`buildCommand` → `build:all`)
- `.railwayignore` (НОВЫЙ)
- `.env.example` (комментарии про same-origin)
- `docs/architecture.md` (отметить отклонение «раздельный деплой» → same-origin для пилота)
- НЕ трогаем: `core/*`, игровой поток/экраны, `rooms.ts`, `seating.ts`, `codes.ts`, `vite.config.ts`
  (base НЕ нужен — `dist/index.html` уже ссылается на `/assets/...` от корня), `tsup.config.ts`.

## Контекст (путь A, согласовано 2026-06-20)

Публикуем гостевой пилот СЕЙЧАС: один адрес `…railway.app` отдаёт и игру (статика `dist/`), и realtime
(socket.io) — **same-origin**. Другу одна ссылка, играют гостями. Аккаунты/кабинеты/лидерборд (2.3→2.4)
доезжают слоями на тот же адрес. Масштаб 10–20 комнат / ~150 человек — один сервер тянет с запасом.

## Под-шаги (микрофазы; каждая = отдельный коммит после ЖИВОЙ проверки)

- [x] 0.1 Сервер отдаёт собранный клиент same-origin (aa28f1c)
- [x] 0.2 Лёгкий `/status` (безопасный мониторинг) (1f97cab)
- [ ] 0.3 Деплой на Railway + прод-проверка

## Хвосты / спящие баги

- `net.ts` / `createOnlineSession` НЕ покрыты юнит-тестами (слепое пятно аудита) — dev/prod-развилку
  проверяем вручную (dev → localhost:3001, prod → same-origin). Регресс-тест — кандидат в backlog.
- `/status` без авторизации и без rate-limit — для дружеского пилота приемлемо; `@fastify/rate-limit`
  на `/status`+`/health` — backlog (дешёвый DoS-вектор GET; сокеты уже защищены cap/anti-brute).
- Тяжёлый клиентский чанк `DiceCanvas` ~2.9 МБ — если билд Railway упрётся в память: `NODE_OPTIONS=
--max-old-space-size=…` или поднять ресурсы билдера (не блокер, проверяемо на 0.3).

---

## НЕЗАВИСИМЫЙ АУДИТ ПЛАНА (проведён до старта; вердикт «реализуем с правками»)

Аудитор эмпирически подтвердил: Fastify + socket.io + SPA-fallback сосуществуют (socket.io path-фильтрует
`/socket.io`, остальное → Fastify `setNotFoundHandler`); same-origin для socket.io работает; `@fastify/static`
v9 защищён от path-traversal по дефолту. Учтённые находки:

- **C1 (корень «прод отстаёт»):** на диске `dist-server/index.js` — СТАРЫЙ (protocol v1). Причина отставания —
  не пересобирался артефакт, а не Railway. → гарантировать пересборку (`build:all`, tsup `clean:true`) +
  `.railwayignore` чтобы старый бандл не протёк в образ.
- **C2:** `@fastify/static` НЕ установлен. → реально `npm i @fastify/static@^9` + коммит `package-lock.json`
  (Railway/Nixpacks ставит по lock; рассинхрон = падение билда).
- **C3:** в ESM-бандле НЕТ `__dirname`/`import.meta` сейчас. → путь к клиенту строго
  `fileURLToPath(new URL('../dist', import.meta.url))` (от `dist-server/` → `../dist`). Проверить, что tsup
  не переписал `import.meta.url` (для esm+node20 — не должен; убедиться артефактом).
- **M1:** при same-origin CORS для основного сценария НЕ задействован; `CLIENT_ORIGIN += прод-домен` — это
  подстраховка/совместимость, а не «иначе сломается».
- **M2:** `build:all` БЕЗ `tsc` (типы — локально); но `vite build` всё равно упадёт на синтаксис-ошибке
  (type-check ≠ transform).
- **M3:** Nixpacks ставит devDeps (`vite`/`tsup`) на билде по дефолту — НЕ выставлять `NPM_CONFIG_PRODUCTION=true`.
- **M4:** добавить `.railwayignore` (`node_modules`, `dist`, `dist-server`, `.git`).
- **M5:** `@fastify/static` БРОСАЕТ на несуществующем `root` → регистрировать ТОЛЬКО при `existsSync(dist)`
  (а не try/catch вокруг listen) — иначе `dev:server`/`dev:all` падают.
- **m2:** `.env` даёт VITE_SERVER_URL='' (пустая строка), `??` её не ловит → развилку делать через
  `import.meta.env.DEV`/`PROD` с явной обработкой пустой строки (`|| undefined`); `io({auth})` идиоматичнее
  `io(undefined, opts)`.
- **Доки:** `architecture.md` (~272–274) фиксирует «два артефакта деплоя раздельно» → обновить под
  same-origin для пилота (раздельный деплой/CDN — когда дорастём до масштаба).

---

## План микрофазы 0.1 — Сервер отдаёт собранный клиент (same-origin)

- **0.1.0** `npm install @fastify/static@^9` → в `dependencies` (рантайм-нужен в проде). Коммит `package.json`
  - `package-lock.json` вместе.
- **0.1.1** `server/index.ts`: `const dist = fileURLToPath(new URL('../dist', import.meta.url))`; если
  `existsSync(dist)` → `app.register(@fastify/static, { root: dist, index: ['index.html'] })` и
  `app.setNotFoundHandler` → для GET не-API вернуть `reply.sendFile('index.html')` (SPA + `?room=`).
  Маршруты `/health` (есть) и будущий `/status` регистрируются как обычно; `/socket.io/*` перехватывает
  engine.io ДО Fastify — fallback его не трогает.
- **0.1.2** `src/platform/net.ts`: заменить
  `const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'`
  на развилку: prod → same-origin (`io({ auth })` без URL), dev → `http://localhost:3001`; пустую строку из
  `.env` трактовать как «не задано». Не зашивать `window.location.origin` руками.
- **0.1.3** `package.json`: скрипт `"build:all": "vite build && tsup"` (БЕЗ `tsc`). НЕ трогать `build`,
  `dev:all`, `build:server`.
- **ЖИВАЯ проверка (артефакты):** `npm run build:all` → `node dist-server/index.js` → `curl -i localhost:3001/`
  = 200 `text/html` (HTML игры, не 404); `curl localhost:3001/health` = 200; открыть в браузере, ДВЕ вкладки —
  создать комнату/войти по коду — партия идёт через один порт. Регрессия: `npm run dev` (Vite :5173 → ходит на
  :3001), `npm test` = 185 зелёных.

## План микрофазы 0.2 — Лёгкий `/status`

- **0.2.1** `server/platform/realtime.ts`: `attachRealtime(...)` возвращает `{ io, getStatus }`, где
  `getStatus()` читает `rooms`/`connections` из замыкания и отдаёт ТОЛЬКО числа:
  `{ connections, rooms: rooms.size, inLobby, inGame, playersOnline }` (явный whitelist). НИКОГДА не
  сериализовать `room.id` (код-пропуск) и `seat.name`.
- **0.2.2** `server/index.ts`: `const { getStatus } = attachRealtime(...)`; `app.get('/status', async () =>
getStatus())`.
- **ЖИВАЯ проверка:** поднять сервер, во вкладке создать комнату → `curl localhost:3001/status` показывает
  `rooms:1, inLobby:1, playersOnline:N`; в ответе НЕТ кода комнаты и имён.

## План микрофазы 0.3 — Деплой на Railway + прод-проверка

- **0.3.0** Создать `.railwayignore`: `node_modules`, `dist`, `dist-server`, `.git`.
- **0.3.1** `railway.json`: `buildCommand` → `npm run build:all` (НЕ `build:server`).
- **0.3.2** Railway env: `CLIENT_ORIGIN` += `https://yahtzee-3d-production.up.railway.app` (через
  `railway variables --set`); убедиться, что `NPM_CONFIG_PRODUCTION` не выставлен (devDeps на билде).
- **0.3.3** `railway up`; дождаться билда/healthcheck.
- **ЖИВАЯ проверка В ПРОДЕ (артефакты):** `curl https://<домен>/health` = 200; `curl https://<домен>/` =
  HTML игры; `curl https://<домен>/status` = числа; node-проба socket.io v3 → connected; открыть домен в
  браузере + второе устройство/вкладка по коду → живая партия по интернету.
- **0.3.4 (доки):** обновить `architecture.md` (~272–274) — отметить same-origin для пилота; поправить
  комментарии `.env.example`. Отметить 2.P done в roadmap, архивировать этот файл в `docs/progress/done/`.
