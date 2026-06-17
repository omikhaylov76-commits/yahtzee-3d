# Auros Design System

> Источник: https://styles.refero.design/style/21cfe0c1-778d-4613-9f47-a5718eb929b3
> Кандидат стиля №1 — «глубокий тёмный океан».

## Name & Mood

**Auros** — "abyssal observatory with bioluminescent data constellations. A dark teal void
where luminous particles, tight display type, and rationed teal-to-lavender gradients signal
liquidity and precision."

Глубоко-океанский «торговый терминал»: почти чёрный тёмно-бирюзовый фон, экстремальная
типографика, минимум объёма поверхностей.

## Color Palette

| Name             | Hex                                                                       | Role                                       |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| Abyssal Teal     | #012624                                                                   | Page canvas, primary background            |
| Midnight Current | #011d1c                                                                   | Card surface, elevated panels              |
| Tide Pool Teal   | #003734                                                                   | Interactive backgrounds, secondary surface |
| Fog Veil         | #bbc7c6                                                                   | Body text, secondary copy                  |
| Ice Mist         | #edfffe                                                                   | Highlight borders, accent strokes          |
| Ash Gray         | #333333                                                                   | Dark borders, separators                   |
| Snow Sheet       | #ffffff                                                                   | Primary headings, nav text                 |
| Lilac Wisp       | #fde9ff                                                                   | Accent border tint (sparingly)             |
| Current Gradient | linear-gradient(90deg, #00827c 0%, #cbfffc 100%)                          | Primary action gradient                    |
| Aurora Gradient  | linear-gradient(90deg, #cbfffc 0%, #edfffe 26%, #fffdfa 48%, #fad1ff 89%) | Ghost buttons, secondary CTAs              |

## Typography

**Primary Font:** Matter (geometric sans), weights 400/500. Fallback: Inter, DM Sans, Satoshi.

- display-xl: 295px / 500 / tracking -13.57px
- display: 96px / tracking -3.84px
- heading-lg: 61px / tracking -1.22px
- eyebrow: 10px / tracking +2.4px (uppercase)
- Line heights: 1.00, 1.30, 1.40, 1.50

## Spacing

- Base unit: 4px. Density: spacious.
- Key values: 12, 16, 20, 24, 28, 32, 36, 40, 48, 64, 80, 120, 140, 156, 160, 172.
- Card padding 40px; section gap 68px; element gap 20px; page max-width 1200px.

## Border Radius

- Tags/buttons/inputs: 6px; Cards: 16px; Avatars: 9999px.

## Core Rules

**Do:** Matter как единственный бренд-шрифт; крупный display с тугим отрицательным трекингом
(86px+); различать поверхности тоном, не тенями; teal→cyan градиент только для главного
действия; секции с 6px бирюзовой точкой; щедрые отступы.
**Don't:** тени/объём; лаванда/розовый как основной цвет; яркие насыщенные цвета на тёмном;
смешение радиусов (только 6px контролы / 16px карточки); веса вне 400/500; видимые рамки
карточек на бирюзовом фоне.
