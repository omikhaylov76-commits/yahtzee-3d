import { describe, it, expect } from 'vitest';
import { eventToSound } from './soundMap';
import type { DomainEvent } from '../core';

describe('eventToSound', () => {
  it('маппит доменные события ядра в звуки', () => {
    expect(eventToSound({ type: 'dice:rolled' })).toBe('dice');
    expect(eventToSound({ type: 'die:held', index: 0 })).toBe('hold');
    expect(eventToSound({ type: 'die:released', index: 0 })).toBe('release');
    expect(eventToSound({ type: 'score:written', player: 0, category: 'chance', points: 10 })).toBe(
      'score',
    );
    expect(eventToSound({ type: 'combo:yahtzee', player: 0, bonus: false })).toBe('yahtzee');
    expect(eventToSound({ type: 'turn:changed', player: 1 })).toBe('turn');
    expect(eventToSound({ type: 'game:over', winnerIds: [0] })).toBe('win');
    expect(eventToSound({ type: 'action:denied', reason: 'category-taken' })).toBe('denied');
  });

  it('возвращает null для неизвестных/безголосых событий', () => {
    expect(eventToSound({ type: 'whatever' } as unknown as DomainEvent)).toBeNull();
  });
});
