import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { RapierRigidBody } from '@react-three/rapier';
import { Euler, Quaternion, Vector3 } from 'three';
import type { Die, DieValue } from '../core';
import { useGameStore } from '../state/gameStore';
import { DIE_HALF } from './constants';
import { VALUE_NORMAL, VALUE_ROTATION } from './dieGeometry';
import { LANDING_MODE } from './landing';
import { PhysicsDie } from './PhysicsDie';
import type { DieHandle } from './Die3D';

// Пороги «успокоились» и тайминги (подбираются на живой проверке).
const SETTLE_LINVEL = 0.2; // линейная скорость, ниже которой кость «почти стоит»
const SETTLE_ANGVEL = 0.3; // угловая скорость
const SETTLE_FRAMES = 8; // сколько кадров подряд нужно «почти стоять»
const MAX_THROW_TIME = 2.6; // c — страховка, если кость не успокаивается
const REORIENT_TIME = 0.42; // c — длительность доворота (режим 'reorient')
const FADE_TIME = 0.18; // c — за сколько точки «проявляются» при посадке ('reveal')
const FLIGHT_OPACITY = 0.22; // прозрачность точек в полёте ('reveal') — лёгкое «размытие»

type Phase = 'rest' | 'thrown' | 'reorient' | 'fadein';

interface Runtime {
  phase: Phase;
  calm: number;
  t: number; // прогресс доворота
  fade: number; // прогресс проявления
  q0: Quaternion;
  qT: Quaternion;
  rest: Vector3;
}

const ZERO = { x: 0, y: 0, z: 0 };
const WORLD_UP = new Vector3(0, 1, 0);

// Переиспользуемые temp-объекты (кадровый цикл, без аллокаций).
const _l = new Vector3();
const _a = new Vector3();
const _up = new Vector3();
const _axis = new Vector3();
const _n = new Vector3();
const _qi = new Quaternion();
const _R = new Quaternion();

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const rand = (amp: number) => (Math.random() * 2 - 1) * amp;

/** Ближайшая координатная ось к вектору (в out). */
function nearestAxis(v: Vector3, out: Vector3): Vector3 {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) out.set(Math.sign(v.x) || 1, 0, 0);
  else if (ay >= az) out.set(0, Math.sign(v.y) || 1, 0);
  else out.set(0, 0, Math.sign(v.z) || 1);
  return out;
}

/**
 * «Проявление»: повернуть группу точек так, чтобы значение `value` оказалось на грани,
 * которая сейчас смотрит вверх — без поворота самого тела. Тело лежит как легло физикой.
 */
function applyReveal(handle: DieHandle, body: RapierRigidBody, value: DieValue) {
  const group = handle.pipGroup;
  if (!group) return;
  const r = body.rotation();
  _qi.set(r.x, r.y, r.z, r.w).invert();
  _up.copy(WORLD_UP).applyQuaternion(_qi); // мировой «вверх» в локальных осях тела
  nearestAxis(_up, _axis);
  const n = VALUE_NORMAL[value];
  _R.setFromUnitVectors(_n.set(n[0], n[1], n[2]), _axis);
  group.quaternion.copy(_R);
}

/** Целевая поза доворота: грань `value` вверх, ближайший из 4 вариантов (режим 'reorient'). */
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
 * кости (Rapier) и приземляет их на значение из ядра (ADR 0004) выбранным способом
 * (LANDING_MODE). На время полёта держит флаг `settling` (гейт UI). Held не трогает.
 */
export function DiceField({ dice, positions }: DiceFieldProps) {
  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  const handles = useRef<(DieHandle | null)[]>([]);
  const runtimes = useRef<Runtime[]>(
    positions.map(() => ({
      phase: 'rest' as Phase,
      calm: 0,
      t: 0,
      fade: 0,
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
      // В режиме «проявление» сразу гасим точки, чтобы не мелькнули на старте полёта.
      if (LANDING_MODE === 'reveal' && handles.current[i]) {
        handles.current[i]!.pipMaterial.opacity = FLIGHT_OPACITY;
      }
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
    let allRest = true;

    for (let i = 0; i < bodies.current.length; i++) {
      const body = bodies.current[i];
      const handle = handles.current[i];
      const rt = runtimes.current[i];
      if (!body || !rt) continue;

      if (rt.phase === 'thrown') {
        allRest = false;
        const lv = body.linvel();
        const av = body.angvel();
        const slow =
          _l.set(lv.x, lv.y, lv.z).length() < SETTLE_LINVEL &&
          _a.set(av.x, av.y, av.z).length() < SETTLE_ANGVEL;
        rt.calm = slow ? rt.calm + 1 : 0;

        // «Проявление»: непрерывно держим нужное значение вверх (точки пока притушены).
        if (LANDING_MODE === 'reveal' && handle) applyReveal(handle, body, ds[i].value);

        if (rt.calm >= SETTLE_FRAMES || throwTime.current > MAX_THROW_TIME) {
          if (LANDING_MODE === 'reorient') {
            const r = body.rotation();
            rt.q0.set(r.x, r.y, r.z, r.w);
            rt.qT.copy(targetQuat(ds[i].value, rt.q0));
            const tr = body.translation();
            rt.rest.set(tr.x, DIE_HALF, tr.z);
            rt.t = 0;
            rt.phase = 'reorient';
          } else if (LANDING_MODE === 'relabel') {
            if (handle) {
              applyReveal(handle, body, ds[i].value);
              handle.pipMaterial.opacity = 1;
            }
            rt.phase = 'rest';
          } else {
            // reveal: зафиксировали значение и проявляем точки
            if (handle) applyReveal(handle, body, ds[i].value);
            rt.fade = 0;
            rt.phase = 'fadein';
          }
        }
      } else if (rt.phase === 'reorient') {
        allRest = false;
        rt.t = Math.min(1, rt.t + delta / REORIENT_TIME);
        _R.copy(rt.q0).slerp(rt.qT, easeOutCubic(rt.t));
        body.setRotation(_R, false);
        body.setTranslation(rt.rest, false);
        body.setLinvel(ZERO, false);
        body.setAngvel(ZERO, false);
        if (rt.t >= 1) rt.phase = 'rest';
      } else if (rt.phase === 'fadein') {
        allRest = false;
        rt.fade = Math.min(1, rt.fade + delta / FADE_TIME);
        if (handle) handle.pipMaterial.opacity = FLIGHT_OPACITY + (1 - FLIGHT_OPACITY) * rt.fade;
        if (rt.fade >= 1) rt.phase = 'rest';
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
          dieRef={(el) => (handles.current[i] = el)}
          position={p}
          value={dice[i].value}
        />
      ))}
    </>
  );
}
