import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { RapierRigidBody } from '@react-three/rapier';
import { Euler, Quaternion, Vector3 } from 'three';
import type { Die, DieValue } from '../core';
import { useGameStore } from '../state/gameStore';
import { DIE_HALF } from './constants';
import { VALUE_ROTATION } from './dieGeometry';
import { PhysicsDie } from './PhysicsDie';

// Пороги «успокоились» и тайминги (подбираются на живой проверке).
const SETTLE_LINVEL = 0.2; // линейная скорость, ниже которой кость «почти стоит»
const SETTLE_ANGVEL = 0.3; // угловая скорость
const SETTLE_FRAMES = 8; // сколько кадров подряд нужно «почти стоять»
const MAX_THROW_TIME = 2.6; // c — страховка, если кость не успокаивается
const REORIENT_TIME = 0.42; // c — длительность плавного доворота на значение ядра

type Phase = 'rest' | 'thrown' | 'reorient';

interface Runtime {
  phase: Phase;
  calm: number;
  t: number;
  q0: Quaternion;
  qT: Quaternion;
  rest: Vector3;
}

/** Плавная кривая: быстрый старт, мягкое замедление — доворот «улёгся», не «дёрнулся». */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const rand = (a: number) => (Math.random() * 2 - 1) * a;

/**
 * Целевая поза: грань `value` смотрит вверх, а из 4 равноправных вариантов (поворот вокруг
 * вертикали) берём ближайший к текущей ориентации — так доворот минимален и незаметнее.
 */
function targetQuat(value: DieValue, current: Quaternion): Quaternion {
  const [x, y, z] = VALUE_ROTATION[value];
  const base = new Quaternion().setFromEuler(new Euler(x, y, z));
  const axis = new Vector3(0, 1, 0);
  let best = base.clone();
  let bestAngle = Infinity;
  for (let k = 0; k < 4; k++) {
    const cand = new Quaternion().setFromAxisAngle(axis, (k * Math.PI) / 2).multiply(base);
    const ang = cand.angleTo(current);
    if (ang < bestAngle) {
      bestAngle = ang;
      best = cand;
    }
  }
  return best;
}

interface DiceFieldProps {
  dice: Die[];
  positions: [number, number, number][];
}

/**
 * Оркестратор костей (F4.3): по событию ядра `dice:rolled` подбрасывает незафиксированные
 * кости (Rapier), ждёт покоя и плавно доворачивает каждую на значение из ядра (ADR 0004).
 * На время полёта держит флаг `settling` (гейт UI). Зафиксированные кости не трогает.
 */
export function DiceField({ dice, positions }: DiceFieldProps) {
  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  const runtimes = useRef<Runtime[]>(
    positions.map(() => ({
      phase: 'rest' as Phase,
      calm: 0,
      t: 0,
      q0: new Quaternion(),
      qT: new Quaternion(),
      rest: new Vector3(),
    })),
  );
  const active = useRef(false);
  const throwTime = useRef(0);

  const events = useGameStore((s) => s.events);
  const setSettling = useGameStore((s) => s.setSettling);

  // Свежие значения/held и позиции — для кадрового цикла без переподписки.
  const diceRef = useRef(dice);
  diceRef.current = dice;
  const posRef = useRef(positions);
  posRef.current = positions;

  // Бросок: реагируем только на новое событие dice:rolled (events меняется лишь при dispatch).
  useEffect(() => {
    if (!events.some((e) => e.type === 'dice:rolled')) return;
    throwTime.current = 0;
    active.current = true;
    setSettling(true);
    const ds = diceRef.current;
    const ps = posRef.current;
    for (let i = 0; i < bodies.current.length; i++) {
      const body = bodies.current[i];
      const rt = runtimes.current[i];
      if (!body || !rt) continue;
      if (ds[i]?.held) {
        rt.phase = 'rest'; // зафиксированную не бросаем
        continue;
      }
      rt.phase = 'thrown';
      rt.calm = 0;
      const p = ps[i];
      body.setTranslation(
        { x: p[0] + rand(0.4), y: 2.6 + Math.random() * 0.6, z: p[2] + rand(0.4) },
        true,
      );
      body.setRotation(
        new Quaternion().setFromEuler(new Euler(rand(Math.PI), rand(Math.PI), rand(Math.PI))),
        true,
      );
      body.setLinvel({ x: rand(2.5), y: -2 - Math.random() * 2, z: rand(2.5) }, true);
      body.setAngvel({ x: rand(12), y: rand(12), z: rand(12) }, true);
    }
  }, [events, setSettling]);

  useFrame((_, delta) => {
    if (!active.current) return;
    throwTime.current += delta;
    const ds = diceRef.current;
    const lv = new Vector3();
    const av = new Vector3();
    let allRest = true;

    for (let i = 0; i < bodies.current.length; i++) {
      const body = bodies.current[i];
      const rt = runtimes.current[i];
      if (!body || !rt) continue;

      if (rt.phase === 'thrown') {
        allRest = false;
        const l = body.linvel();
        const a = body.angvel();
        const slow =
          lv.set(l.x, l.y, l.z).length() < SETTLE_LINVEL &&
          av.set(a.x, a.y, a.z).length() < SETTLE_ANGVEL;
        rt.calm = slow ? rt.calm + 1 : 0;
        if (rt.calm >= SETTLE_FRAMES || throwTime.current > MAX_THROW_TIME) {
          const r = body.rotation();
          rt.q0 = new Quaternion(r.x, r.y, r.z, r.w);
          rt.qT = targetQuat(ds[i].value, rt.q0);
          const tr = body.translation();
          rt.rest.set(tr.x, DIE_HALF, tr.z);
          rt.t = 0;
          rt.phase = 'reorient';
        }
      } else if (rt.phase === 'reorient') {
        allRest = false;
        rt.t = Math.min(1, rt.t + delta / REORIENT_TIME);
        const q = rt.q0.clone().slerp(rt.qT, easeOutCubic(rt.t));
        // Кость уже почти стоит: фиксируем позу и гасим скорости, чтобы доворот был ровным.
        body.setRotation(q, false);
        body.setTranslation(rt.rest, false);
        body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        if (rt.t >= 1) rt.phase = 'rest';
      }
    }

    if (allRest) {
      active.current = false;
      setSettling(false); // эквивалент dice:settled для UI; звук подключит F5
    }
  });

  return (
    <>
      {positions.map((p, i) => (
        <PhysicsDie
          key={i}
          ref={(el) => (bodies.current[i] = el)}
          position={p}
          value={dice[i].value}
        />
      ))}
    </>
  );
}
