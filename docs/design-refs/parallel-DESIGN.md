# Parallel Design System

> Источник: https://styles.refero.design/style/2230ba53-445e-411d-b483-16410a072639
> Кандидат стиля №3 — тёплый/уютный «настольный» (бумага, тёплый свет). Найден мной в
> библиотеке refero как ответ на запрос «дерево / мягкий свет».

## Name & Mood

**Parallel** — "Warm editorial atelier. Cream paper, charcoal ink, and one ember-orange period
of emphasis." Тёплая «бумажная» эстетика арт-альбома при янтарном свете, сдержанность вместо
SaaS-глянца. (Кремовая бумага + один тёплый оранжевый акцент — ближе всего к настольному
ощущению дерева/уюта среди стилей библиотеки.)

## Color Palette

| Name             | Hex     | Role                          |
| ---------------- | ------- | ----------------------------- |
| Cream Paper      | #e4dfd9 | Page background canvas        |
| Pure White       | #ffffff | Card surfaces, inputs         |
| Charcoal Ink     | #000000 | Primary text, borders         |
| Near Black       | #050505 | Body text warmth              |
| Pressed Graphite | #171717 | Filled buttons, dark surfaces |
| Slate            | #737373 | Secondary text                |
| Iron             | #4b4b4b | Dark borders                  |
| Stone            | #999694 | Muted copy, placeholders      |
| Pewter           | #666666 | Hairline borders              |
| Fog              | #c7c7c7 | Most frequent border color    |
| Ember Dot        | #ff6a1f | Single chromatic accent only  |

## Typography

**Display:** Rules Font (weight 500), 28px / 69px, tracking -0.02em. Fallback: Söhne Breit,
GT America, Inter 500.
**Body:** ui-sans-serif (400/500/600), 14/16/19/23px, tracking -0.02em. Fallback: Inter, Geist.

- display 69px/1.1; heading 28px/1.4; subheading 19px/1.4; body 16px/1.5; caption 14px/1.2.

## Spacing & Layout

- Max width 1200px; section gap 24–32px; card padding 32px; element gap 8px; density comfortable.
- Scale: 8, 10, 12, 14, 16, 18, 22, 24, 32, 40, 54, 58, 72, 74, 100, 122.

## Border Radius

Cards 20px; Buttons 8px; Inputs 12px; Icons 8px; Pills 9999px.

## Shadows

Единственный мягкий паттерн: `rgba(0,0,0,0.07) 0px 6px 27px 0px`.

## Core Rules

**Do:** Cream Paper как фон по умолчанию; Rules Font 500 на 28/69px с -0.02em; карточки 20px,
кнопки 8px, инпуты 12px, пиллы 9999px; Ember Dot (#ff6a1f) только для статусов/точки в
заголовке/бейджей; 32px паддинг карточек; первичные кнопки Pressed Graphite (#171717) с белым
текстом.
**Don't:** другие хроматические цвета кроме Ember Dot; жирные (700+) заголовки; тени сверх
единственного паттерна; чистый чёрный для кнопок; радиус 4px/0px на карточках/кнопках;
несколько хроматических элементов на экран.
