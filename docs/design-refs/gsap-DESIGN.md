# GSAP Design System

> Источник: https://styles.refero.design/style/00537a20-e99e-4ef2-b119-c6f532c44cc9
> Кандидат стиля №2 — «тёмный неон».

## Name & Mood

**Gsap** — "neon playground in midnight void — dark canvas where every color glows".
Тёмный холст, на котором каждый цвет «светится».

## Color Palette

| Color           | Hex     | Role                                |
| --------------- | ------- | ----------------------------------- |
| Void Black      | #0e100f | Primary background canvas           |
| Cream Glow      | #fffce1 | Primary text, icons, borders        |
| Pulse Green     | #0ae448 | Brand primary accent                |
| Candy Pink      | #fec5fb | Category accent                     |
| Ember Orange    | #ff8709 | Category accent                     |
| Electric Violet | #9d95ff | Category accent                     |
| Signal Blue     | #00bae2 | Category accent                     |
| Lime Flash      | #abff84 | Gradient endpoint, secondary accent |
| Olive Stone     | #42433d | Muted borders, dividers             |
| Ash Gray        | #7c7c6f | Metadata, secondary UI              |

## Typography

**Font:** Mori (display), weights 400 (primary) / 600 (emphasis only). Fallback: Inter Tight.

- Sizes: 14px–224px (19 шагов). Line height 0.90–1.40 (туже на крупном).
- Letter spacing: -0.010em (body), -0.011em (mid), -0.020em (hero 66px+).

## Spacing & Shape

- Base unit 4px; section gap 80px; card padding 24px; element gap 16px.
- Border radius: 8px (cards) | 100px (pills/buttons/nav). Max width 1280px.

## Core Rules

**Do:** 100px радиус для всех кнопок/пиллов (подпись стиля); литеральные `{ фигурные скобки }`
как декор вокруг лейблов; плоский холст #0e100f, разделение 1px хайрлайнами; вес 600 только
для акцента/активных; разные акцентные цвета по категориям; трекинг туже с размером.
**Don't:** тени/свечения/объём; более светлые карточные поверхности; радиус между 9–99px
(прыжок 8→100); заливка кнопок акцентом (только ghost/outline); line-height >1.40 в body;
вес 600 более 2–3 слов; смешение акцентов внутри одного слова.
