# f1-core (фича в roadmap: Веха 1 → F1. Ядро правил и счёта)

Последний коммит по фиче: 516d1ce (под-шаг 3) — ФИЧА F1 ЗАКРЫТА
Файлы под-шага (тронем): см. по под-шагам ниже. ЯДРО чистое — без React/3D/звука/DOM.

Цель F1: детерминированное «ядро» игры на чистом TS, покрытое тестами (Vitest):
типы состояния, сидируемый RNG, `reduce(state, action) -> { state, events }`, счёт по 13
категориям, верхний бонус, бонусные Yahtzee, правило джокера, конец игры и победитель.
Без UI и 3D. Соответствует ADR 0003 (Transport/actions/events) и ADR 0004 (кости решает ядро).

## Модель данных (фиксируем здесь)

- `Category` — 13 строк: ones..sixes, threeKind, fourKind, fullHouse, smallStraight,
  largeStraight, yahtzee, chance.
- `DieValue` = 1..6; `Die` = { value: DieValue; held: boolean }.
- `ScoreCard` = частичная карта `Category -> number` (записанные категории, в т.ч. 0).
- `Player` = { id: string; name: string; card: ScoreCard; bonusYahtzees: number }.
- `GameState` = {
  players: Player[]; current: number; dice: Die[] (ровно 5);
  rollsLeft: number (3 в начале хода → 0); rolledThisTurn: boolean;
  phase: 'playing' | 'over'; winnerIds: number[];
  seed: number; rng: number (состояние ГПСЧ, чтобы reduce был чистым);
  gameId?: string (задел под сеть, ADR 0003)
  }
- `Action` = NEW_GAME{players:{name}[]; seed?} | ROLL | TOGGLE_HOLD{index} | SCORE{category}.
- `DomainEvent` (для звука/сочности): dice:rolled, die:held, die:released, score:written,
  action:denied{reason}, combo:yahtzee, turn:changed, game:over.

## Правила (поведение reduce)

- NEW_GAME: создать игроков, dice=5×{value:1,held:false}, rollsLeft=3, rolledThisTurn=false,
  current=0, phase='playing'. seed → начальное состояние rng.
- ROLL: разрешён, если phase=playing и rollsLeft>0. Перебросить НЕ-held кости через RNG,
  rollsLeft--, rolledThisTurn=true. Иначе action:denied. Событие dice:rolled.
- TOGGLE_HOLD{index}: разрешён, если rolledThisTurn и rollsLeft>0 (между бросками) и
  phase=playing. Переключить held. Событие die:held / die:released. Иначе denied.
- SCORE{category}: разрешён, если rolledThisTurn, категория свободна, phase=playing.
  Посчитать очки (с учётом джокера/бонуса — под-шаг 3), записать в card, score:written.
  Затем перейти к следующему игроку: dice сброс, rollsLeft=3, rolledThisTurn=false,
  turn:changed. Если ВСЕ карты заполнены — phase='over', winnerIds (макс. итог, допускается
  ничья), game:over. Иначе denied при нарушении.

## Под-шаги

- [x] 1. **Типы + счёт категорий.** (2a21085) Файлы: `src/core/types.ts`, `src/core/scoring.ts`,
     `src/core/scoring.test.ts`. Чистые функции: `scoreCategory(dice, cat)`, `upperSum(card)`,
     `totalScore(player)` (категории + верхний бонус +35 при верх≥63 + бонусные Yahtzee×100).
     Тесты на каждую категорию и бонус. 13 тестов зелёные.
- [x] 2. **RNG + reducer хода.** (3f26e55) Файлы: `src/core/rng.ts`, `src/core/game.ts`,
     `src/core/index.ts` (barrel), `src/core/game.test.ts`. Сидируемый ГПСЧ (mulberry32),
     `createGame`, `reduce` для NEW_GAME/ROLL/TOGGLE_HOLD/SCORE (БЕЗ джокера пока: yahtzee=50
     как обычно), смена хода, конец игры, победитель, события, отказы (denied). Тесты:
     детерминизм по seed, лимит 3 броска, hold/переброс, запрет недоступного, полный матч на
     2 игрока до game:over.
- [x] 3. **Бонусные Yahtzee + джокер.** (516d1ce) Файлы: правки `src/core/scoring.ts` и
     `src/core/game.ts`, тесты `src/core/joker.test.ts`. Если выпал Yahtzee, а категория
     yahtzee уже занята 50 → +100 (bonusYahtzees++); запись по правилу джокера (верхняя по
     достоинству; если занята — нижняя секция с «джокерными» очками: FH=25/SS=30/LS=40;
     иначе 0). Бонус НЕ даётся, если yahtzee ранее записан как 0. Тесты на все ветки джокера.

## Граничные случаи (учесть в тестах)

- Yahtzee при незаполненной категории yahtzee → обычные 50, без +100.
- Yahtzee, yahtzee=50 занят, нужная верхняя занята → джокер в нижнюю.
- Yahtzee, yahtzee=0 (записан нулём ранее) → НЕТ +100, джокер применяется.
- Малый/большой стрит распознаются в любом порядке костей.
- Full House: 3+2; 5 одинаковых считать как Full House? — нет, по полным правилам 5 одинаковых
  = Yahtzee; Full House только 3+2 (если не джокер). Зафиксировать тестом.
- Запрет: ROLL при rollsLeft=0; SCORE в занятую; любые действия при phase=over.
- Ничья: одинаковый максимум → несколько winnerIds.

## Как проверим (живая проверка)

- `npm run test` (Vitest) — все тесты зелёные (привести вывод).
- `npm run build` + `npm run lint` — чисто.
- Мини-демо: маленький скрипт/REPL-прогон полного матча 2 игроков через `reduce`, печать
  итогов и победителя (привести реальный вывод) — доказательство работы ядра без UI.

Хвосты / спящие баги (перенесены в roadmap backlog):

- Строгое принуждение бокса при джокере (сначала верхний по достоинству) не enforced —
  запись свободная, счёт корректный. Возможное уточнение правил.

ИТОГ F1: ядро готово, 34 теста зелёные, демо полного матча отработало. Коммиты 2a21085,
3f26e55, 516d1ce.
