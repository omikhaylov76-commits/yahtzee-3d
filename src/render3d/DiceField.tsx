import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier, type RapierRigidBody } from '@react-three/rapier';
import { Euler, Quaternion, Vector3 } from 'three';
import type { Die, DieValue } from '../core';
import { useGameStore } from '../state/gameStore';
import { DIE_HALF, PHYS } from './constants';
import { VALUE_NORMAL, VALUE_ROTATION } from './dieGeometry';
import { LANDING_MODE } from './landing';
import { predictThrows, type DieRecording, type DieThrow } from './predictor';
import { PhysicsDie } from './PhysicsDie';
import type { DieHandle } from './Die3D';

// Пороги «успокоились» и тайминги (для физических режимов; presim воспроизводит запись).
const SETTLE_LINVEL = 0.2;
const SETTLE_ANGVEL = 0.3;
const SETTLE_FRAMES = 8;
const MAX_THROW_TIME = 2.6;
const REORIENT_TIME = 0.42; // 'reorient'
const FADE_TIME = 0.18; // 'reveal'
const FLIGHT_OPACITY = 0.22; // 'reveal'

type Phase = 'rest' | 'thrown' | 'reorient' | 'fadein' | 'replay';

interface Runtime {
  phase: Phase;
  calm: number;
  t: number; // прогресс доворота ('reorient')
  fade: number; // прогресс проявления ('reveal')
  frame: number; // текущий кадр записи ('presim')
  acc: number; // накопитель времени для шага записи ('presim')
  q0: Quaternion;
  qT: Quaternion;
  rest: Vector3;
}

const ZERO = { x: 0, y: 0, z: 0 };
const WORLD_UP = new Vector3(0, 1, 0);

// Переиспользуемые temp-объекты (без аллокаций в кадре).
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

/** Повернуть группу точек так, чтобы значение `value` встало на грань, что смотрит вверх при ориентации `q`. */
function relabelTo(handle: DieHandle, q: Quaternion, value: DieValue) {
  const group = handle.pipGroup;
  if (!group) return;
  _qi.copy(q).invert();
  _up.copy(WORLD_UP).applyQuaternion(_qi); // мировой «вверх» в локальных осях тела
  nearestAxis(_up, _axis);
  const n = VALUE_NORMAL[value];
  _R.setFromUnitVectors(_n.set(n[0], n[1], n[2]), _axis);
  group.quaternion.copy(_R);
}

/** Переразметка под финальную ориентацию записи (presim): точки фиксируются ОДИН раз. */
function relabelForFinal(
  handle: DieHandle,
  finalQuat: [number, number, number, number],
  value: DieValue,
) {
  _qi.set(finalQuat[0], finalQuat[1], finalQuat[2], finalQuat[3]);
  relabelTo(handle, _qi, value);
}

/** «Проявление» (reveal): держим значение вверх по ТЕКУЩЕЙ ориентации тела. */
function relabelLive(handle: DieHandle, body: RapierRigidBody, value: DieValue) {
  const r = body.rotation();
  _qi.set(r.x, r.y, r.z, r.w);
  relabelTo(handle, _qi, value);
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

/** Случайные стартовые условия броска для предсказателя. */
function makeThrow(p: [number, number, number]): DieThrow {
  const q = new Quaternion().setFromEuler(new Euler(rand(Math.PI), rand(Math.PI), rand(Math.PI)));
  return {
    pos: [p[0] + rand(0.4), 2.6 + Math.random() * 0.6, p[2] + rand(0.4)],
    rot: [q.x, q.y, q.z, q.w],
    lin: [rand(2.5), -2 - Math.random() * 2, rand(2.5)],
    ang: [rand(12), rand(12), rand(12)],
  };
}

interface DiceFieldProps {
  dice: Die[];
  positions: [number, number, number][];
  /** Можно ли сейчас фиксировать кости кликом (ход, после броска, не в полёте). */
  canHold: boolean;
}

/**
 * Оркестратор костей (F4.3): по событию ядра `dice:rolled` приземляет незафиксированные кости
 * на значение из ядра (ADR-0004) способом LANDING_MODE. По умолчанию 'presim' (вариант A):
 * предрасчёт броска → переразметка точек один раз → воспроизведение записи. На время полёта
 * держит флаг `settling` (гейт UI). Held не трогает.
 */
export function DiceField({ dice, positions, canHold }: DiceFieldProps) {
  const { rapier } = useRapier();
  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  const handles = useRef<(DieHandle | null)[]>([]);
  const recs = useRef<(DieRecording | null)[]>([]);
  const runtimes = useRef<Runtime[]>(
    positions.map(() => ({
      phase: 'rest' as Phase,
      calm: 0,
      t: 0,
      fade: 0,
      frame: 0,
      acc: 0,
      q0: new Quaternion(),
      qT: new Quaternion(),
      rest: new Vector3(),
    })),
  );
  const active = useRef(false);
  const throwTime = useRef(0);

  const events = useGameStore((s) => s.events);
  const setSettling = useGameStore((s) => s.setSettling);
  const toggleHold = useGameStore((s) => s.toggleHold);

  const diceRef = useRef(dice);
  diceRef.current = dice;
  const posRef = useRef(positions);
  posRef.current = positions;

  // Бросок: реагируем только на новое событие dice:rolled.
  useEffect(() => {
    if (!events.some((e) => e.type === 'dice:rolled')) return;
    const ds = diceRef.current;
    const ps = posRef.current;
    throwTime.current = 0;
    active.current = true;
    setSettling(true);

    if (LANDING_MODE === 'presim') {
      // 1) собрать броски незафиксированных костей, 2) предсказать траектории+грань,
      // 3) переразметить точки ОДИН раз, 4) запустить воспроизведение записи.
      const idx: number[] = [];
      const throws: DieThrow[] = [];
      for (let i = 0; i < bodies.current.length; i++) {
        const rt = runtimes.current[i];
        if (!rt) continue;
        if (ds[i]?.held) {
          rt.phase = 'rest';
          continue;
        }
        idx.push(i);
        throws.push(makeThrow(ps[i]));
      }
      const recordings = predictThrows(rapier, throws);
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        recs.current[i] = recordings[k];
        const handle = handles.current[i];
        if (handle) {
          relabelForFinal(handle, recordings[k].finalQuat, ds[i].value);
          handle.pipMaterial.opacity = 1; // точки чёткие всё время
        }
        const rt = runtimes.current[i];
        rt.phase = 'replay';
        rt.frame = 0;
        rt.acc = 0;
      }
      return;
    }

    // Физические режимы (reveal/reorient/relabel): реальный бросок на месте.
    for (let i = 0; i < bodies.current.length; i++) {
      const body = bodies.current[i];
      const rt = runtimes.current[i];
      if (!body || !rt) continue;
      if (ds[i]?.held) {
        rt.phase = 'rest';
        continue;
      }
      rt.phase = 'thrown';
      rt.calm = 0;
      if (LANDING_MODE === 'reveal' && handles.current[i]) {
        handles.current[i]!.pipMaterial.opacity = FLIGHT_OPACITY;
      }
      const t = makeThrow(ps[i]);
      body.setTranslation({ x: t.pos[0], y: t.pos[1], z: t.pos[2] }, true);
      body.setRotation({ x: t.rot[0], y: t.rot[1], z: t.rot[2], w: t.rot[3] }, true);
      body.setLinvel({ x: t.lin[0], y: t.lin[1], z: t.lin[2] }, true);
      body.setAngvel({ x: t.ang[0], y: t.ang[1], z: t.ang[2] }, true);
    }
  }, [events, setSettling, rapier]);

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

      if (rt.phase === 'replay') {
        allRest = false;
        const rec = recs.current[i];
        if (!rec) {
          rt.phase = 'rest';
          continue;
        }
        rt.acc += delta;
        const last = rec.frames.length - 1;
        while (rt.acc >= PHYS.timeStep && rt.frame < last) {
          rt.frame += 1;
          rt.acc -= PHYS.timeStep;
        }
        const f = rec.frames[Math.min(rt.frame, last)];
        body.setTranslation({ x: f[0], y: f[1], z: f[2] }, true);
        body.setRotation({ x: f[3], y: f[4], z: f[5], w: f[6] }, true);
        body.setLinvel(ZERO, false);
        body.setAngvel(ZERO, false);
        if (rt.frame >= last) rt.phase = 'rest';
      } else if (rt.phase === 'thrown') {
        allRest = false;
        const lv = body.linvel();
        const av = body.angvel();
        const slow =
          _l.set(lv.x, lv.y, lv.z).length() < SETTLE_LINVEL &&
          _a.set(av.x, av.y, av.z).length() < SETTLE_ANGVEL;
        rt.calm = slow ? rt.calm + 1 : 0;

        if (LANDING_MODE === 'reveal' && handle) relabelLive(handle, body, ds[i].value);

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
              relabelLive(handle, body, ds[i].value);
              handle.pipMaterial.opacity = 1;
            }
            rt.phase = 'rest';
          } else {
            if (handle) relabelLive(handle, body, ds[i].value);
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
          held={dice[i].held}
          onSelect={canHold ? () => toggleHold(i) : undefined}
        />
      ))}
    </>
  );
}
