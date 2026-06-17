# f2-transport (фича в roadmap: Веха 1 → F2. Transport + Storage + стор)

Последний коммит по фиче: 80e6c84 (под-шаг 1)
Файлы под-шага (тронем): см. по под-шагам. Слои вокруг ядра; ядро (src/core) НЕ меняем.

Цель F2: «провод» между ядром и будущим UI/3D/звуком — по контрактам из architecture.md:

- `GameStorage` (автосохранение партии в localStorage, ADR 0005);
- `Transport` (действие/состояние; LocalTransport сейчас, NetworkTransport-заглушка — точка
  под сеть, ADR 0003);
- Zustand-стор как мост: React-экраны читают состояние и шлют действия.
  Графики/UI ещё нет — это инфраструктура под F3.

## Контракты (фиксируем)

```ts
interface GameStorage {
  save(state: GameState): void;
  load(): GameState | null; // null, если нет/повреждено/иная версия
  clear(): void;
}

interface Transport {
  getState(): GameState | null;
  dispatch(action: Action): void;
  subscribe(cb: (state: GameState | null, events: DomainEvent[]) => void): () => void;
}
```

## Под-шаги

- [x] 1. **Storage.** (80e6c84) Файлы: `src/storage/GameStorage.ts` (интерфейс),
     `src/storage/localStorageGameStorage.ts` (реализация: версионированный ключ
     `yahtzee3d:v1:game`, try/catch, повреждённое/иная версия → null, clear),
     `src/storage/memoryGameStorage.ts` (для тестов и SSR-фолбэка),
     `src/storage/storage.test.ts`. Тесты: save→load round-trip, clear, повреждённый JSON →
     null, отсутствие ключа → null.

- [~] 2. **Transport.** Файлы: `src/transport/Transport.ts` (интерфейс + тип колбэка),
  `src/transport/LocalTransport.ts` (хранит state; NEW_GAME → createGame с СЛУЧАЙНЫМ seed,
  инъекция seed на границе — ядро остаётся чистым; прочие действия → reduce; после каждого
  dispatch save в GameStorage и notify подписчиков с событиями; при старте load из
  storage — восстановление партии), `src/transport/NetworkTransport.ts` (пустой класс-
  заглушка, методы кидают «не реализовано, Веха 2», TODO-точка под сервер),
  `src/transport/transport.test.ts`. Тесты: dispatch применяет reduce; подписчики получают
  state+events; персист в memoryStorage; восстановление из storage при создании;
  NetworkTransport кидает.

- [ ] 3. **Zustand-стор (мост).** Зависимость: добавить `zustand` (согласовано в стеке).
     Файлы: `src/state/gameStore.ts` (фабрика `createGameStore(transport)` + дефолтный
     `useGameStore` на LocalTransport+localStorage; поля: `state`, `events`; методы
     `newGame(players)`, `roll()`, `toggleHold(i)`, `score(cat)` — все через transport;
     подписка на transport обновляет стор), `src/state/gameStore.test.ts` (vanilla-стор:
     newGame наполняет state, roll/score меняют state через мост, restore из storage).

## Граничные случаи

- localStorage недоступен (приватный режим/SSR) → не падать, вести себя как «нет сохранения»
  (memory-фолбэк или тихий catch).
- Действие до NEW_GAME (нет активной партии) → transport игнорирует (state остаётся null).
- Версия ключа сменилась → load возвращает null (старое не ломает новое).
- Сид: NEW_GAME без seed → transport подставляет случайный (Math.random на границе);
  с явным seed (тесты) → детерминизм.

## Как проверим (живая проверка)

- `npm run test` — все тесты (ядро 34 + новые) зелёные (вывод).
- `npm run build` + `npm run lint` — чисто.
- Мини-демо: создать LocalTransport на memoryStorage, NEW_GAME → ROLL → SCORE, показать,
  что state меняется и (через отдельный storage) партия восстанавливается новым transport.

Хвосты / спящие баги: нет
