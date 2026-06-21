/**
 * Тесты чистого ядра resume-on-reload (2.4.c-3-3): разбор/валидация сохранённого в sessionStorage
 * значения и его превращение в намерение входа. Сам sessionStorage не трогаем (его обёртки тривиальны
 * и проверяются интеграционно в gameStore.test.ts со стендом sessionStorage).
 */
import { describe, it, expect } from 'vitest';
import { parseResume, resumeToIntent, type ResumeInfo } from './resumeSession';

describe('parseResume', () => {
  it('валидный join с именем', () => {
    const raw = JSON.stringify({ type: 'join', roomId: 'AB12CD', token: 'tok', name: 'Alice' });
    expect(parseResume(raw)).toEqual({
      type: 'join',
      roomId: 'AB12CD',
      token: 'tok',
      name: 'Alice',
    });
  });

  it('валидный joinOpen без имени', () => {
    const raw = JSON.stringify({ type: 'joinOpen', roomId: 'tide', token: 't' });
    expect(parseResume(raw)).toEqual({ type: 'joinOpen', roomId: 'tide', token: 't' });
  });

  it('null / пустая строка → null', () => {
    expect(parseResume(null)).toBeNull();
    expect(parseResume('')).toBeNull();
  });

  it('не-JSON → null (не падаем)', () => {
    expect(parseResume('{ не json')).toBeNull();
  });

  it('чужой тип / пустой roomId / нет токена / пустой токен → null', () => {
    expect(parseResume(JSON.stringify({ type: 'create', roomId: 'X', token: 't' }))).toBeNull();
    expect(parseResume(JSON.stringify({ type: 'join', roomId: '', token: 't' }))).toBeNull();
    expect(parseResume(JSON.stringify({ type: 'join', roomId: 'X' }))).toBeNull();
    expect(parseResume(JSON.stringify({ type: 'join', roomId: 'X', token: '' }))).toBeNull();
  });

  it('пустое имя отбрасывается (не кладём name:"")', () => {
    const raw = JSON.stringify({ type: 'join', roomId: 'X', token: 't', name: '' });
    expect(parseResume(raw)).toEqual({ type: 'join', roomId: 'X', token: 't' });
  });
});

describe('resumeToIntent', () => {
  it('join → {type:join, code} (приватная комната по коду)', () => {
    const info: ResumeInfo = { type: 'join', roomId: 'AB12CD', token: 't', name: 'Bob' };
    expect(resumeToIntent(info)).toEqual({ type: 'join', code: 'AB12CD', name: 'Bob' });
  });

  it('joinOpen → {type:joinOpen, tableId} (открытый/дежурный стол)', () => {
    const info: ResumeInfo = { type: 'joinOpen', roomId: 'tide', token: 't' };
    expect(resumeToIntent(info)).toEqual({ type: 'joinOpen', tableId: 'tide' });
  });
});
