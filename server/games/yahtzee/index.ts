/**
 * Подключение игры Yahtzee к серверной платформе (граница платформа/игра, ADR-0011).
 * Сейчас — тонкий дескриптор: проба, что ядро (`core`) реально импортируется на сервере
 * (импорты без расширений, ESM). Полноценный `GameModule` (reduce/toPublicState/...) — в 2.1.
 */
import { CATEGORIES } from '../../../src/core';

export const yahtzeeModule = {
  id: 'yahtzee' as const,
  categories: CATEGORIES.length,
};
