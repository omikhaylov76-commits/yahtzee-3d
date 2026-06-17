/**
 * Маппинг доменных событий ядра → звуковые события (F5). Чистая функция — слой звука не лезет
 * в правила, только переводит события в звуки. Покрыто тестом.
 */
import type { DomainEvent } from '../core';
import type { SoundEvent } from './SoundEngine';

export function eventToSound(event: DomainEvent): SoundEvent | null {
  switch (event.type) {
    case 'dice:rolled':
      return 'dice';
    case 'die:held':
      return 'hold';
    case 'die:released':
      return 'release';
    case 'score:written':
      return 'score';
    case 'combo:yahtzee':
      return 'yahtzee';
    case 'turn:changed':
      return 'turn';
    case 'game:over':
      return 'win';
    case 'action:denied':
      return 'denied';
    default:
      return null;
  }
}
