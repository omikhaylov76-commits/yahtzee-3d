import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier, type RapierRigidBody } from '@react-three/rapier';
import { Euler, Quaternion, Vector3 } from 'three';
import type { Die, DieValue } from '../core';
import { useGameStore } from '../state/gameStore';
import { DIE_HALF, PHYS } from './constants';
import { VALUE_NORMAL, VALUE_ROTATION } from './dieGeometry';
import { LANDING_MODE } from './landing';
import { valuesDiffer } from './diceDiff';
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

// Зона «отложенных» (F4.4b): отдельная нижняя полоска у переднего края (перед стенкой брос-
// ка ARENA.frontZ), мельче брошенных, но мягко — для гармонии.
const KEPT_Z = 3.0; // нижний/передний край экрана, с запасом — целиком в кадре
const KEPT_GAP = 0.72;
const KEPT_SCALE = 0.6; // компактный скромный ряд
const MOVE_LERP = 9; // скорость переезда в рядок и обратно (доля к цели в секунду)
const MOVE_DONE = 0.02; // порог «доехала»
const GATHER_TIME = 0.7; // c — плавный «сбор» костей в ряд на новый ход

type Phase = 'rest' | 'thrown' | 'reorient' | 'fadein' | 'replay' | 'gather';

interface Runtime {
  phase: Phase;
  calm: number;
  t: number; // прогресс доворота/сбора ('reorient'/'gather')
  fade: number; // прогресс проявления ('reveal')
  frame: number; // текущий кадр записи ('presim')
  acc: number; // накопитель времени для шага записи ('presim')
  placement: 'free' | 'kept'; // где кость: в зоне броска или в рядке отложенных (F4.4b)
  q0: Quaternion; // стартовый поворот тела (доворот/сбор)
  qT: Quaternion;
  pip0: Quaternion; // стартовый поворот группы точек (сбор)
  from: Vector3; // стартовая позиция (сбор)
  rest: Vector3; // целевая позиция
}

const ZERO = { x: 0, y: 0, z: 0 };
const WORLD_UP = new Vector3(0, 1, 0);
const IDENTITY_Q = new Quaternion();

// Переиспользуемые temp-объекты (без аллокаций в кадре).
const _l = new Vector3();
const _a = new Vector3();
const _up = new Vector3();
const _axis = new Vector3();
const _n = new Vector3();
const _p = new Vector3();
const _tp = new Vector3();
const _qi = new Quaternion();
const _R = new Quaternion();

/** Слот в рядке отложенных: k-я кость из count по центру, на столе. */
function keptSlot(order: number, count: number, out: Vector3): Vector3 {
  const start = -((count - 1) * KEPT_GAP) / 2;
  return out.set(start + order * KEPT_GAP, DIE_HALF, KEPT_Z);
}

/**
 * Плавно подвинуть тело к цели (кинематика, вне физики: телепорт по lerp, скорости в ноль).
 * Ориентацию НЕ трогаем — значение/переразметка сохраняются. Возвращает «доехала ли».
 */
function moveToward(body: RapierRigidBody, target: Vector3, delta: number): boolean {
  const c = body.translation();
  _p.set(c.x, c.y, c.z);
  const arrived = _p.distanceTo(target) < MOVE_DONE;
  _p.lerp(target, Math.min(1, delta * MOVE_LERP));
  body.setTranslation({ x: _p.x, y: _p.y, z: _p.z }, true);
  body.setLinvel(ZERO, false);
  body.setAngvel(ZERO, false);
  return arrived;
}

/** Плавно подвести масштаб визуала кости к цели (для скромного вида отложенных). */
function lerpScale(handle: DieHandle | null, target: number, delta: number) {
  const root = handle?.root;
  if (!root) return;
  const s = root.scale.x + (target - root.scale.x) * Math.min(1, delta * MOVE_LERP);
  root.scale.setScalar(s);
}

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
  // ~30% костей — «раскатчики»: иногда катятся подальше (интрига, что выпадет).
  const roller = Math.random() < 0.3;
  const fwd = roller ? 5.2 + Math.random() * 1.6 : 3.8 + Math.random() * 1.1; // скорость вперёд (−z)
  const fan = roller ? 1.6 + Math.random() * 0.9 : 0.9 + Math.random() * 0.7; // лёгкий разлёт вбок
  const outward = p[0] >= 0 ? 1 : -1;
  const rollX = -fwd / DIE_HALF; // угловая под КАЧЕНИЕ вперёд (без проскальзывания)
  return {
    // Бросок «от меня В ЭКРАН»: старт ПЕРЕД передним бортиком (близко к камере), кости влетают
    // над низким бортиком, приземляются близко и КАТЯТСЯ вперёд (−z), кувыркаясь, к середине.
    pos: [p[0] * 0.8 + rand(0.3), 1.9 + Math.random() * 0.3, 2.5 + rand(0.2)],
    rot: [q.x, q.y, q.z, q.w],
    lin: [outward * fan + rand(0.6), -0.5 - Math.random() * 0.5, -fwd],
    ang: [rollX + rand(2.0), rand(2.5), rand(2.0)], // в основном качение по X + лёгкий вобл
  };
}

/** «Подскок» Nudge: из текущей позы кости — толчок вверх + умеренный спин (в зоне броска). */
function makeNudge(pos: [number, number, number], rot: [number, number, number, number]): DieThrow {
  return {
    pos: [pos[0], pos[1] + 0.05, pos[2]],
    rot,
    // Толчок вверх компенсирует возросшую гравитацию (хоп виден, но небольшой).
    lin: [rand(1.0), 3.4 + Math.random() * 1.0, rand(1.0)],
    ang: [rand(7), rand(7), rand(7)],
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
      placement: 'free' as 'free' | 'kept',
      q0: new Quaternion(),
      qT: new Quaternion(),
      pip0: new Quaternion(),
      from: new Vector3(),
      rest: new Vector3(),
    })),
  );
  const active = useRef(false);
  const throwTime = useRef(0);

  const events = useGameStore((s) => s.events);
  const setSettling = useGameStore((s) => s.setSettling);
  const toggleHold = useGameStore((s) => s.toggleHold);
  const nudgeNonce = useGameStore((s) => s.nudgeNonce);

  const diceRef = useRef(dice);
  diceRef.current = dice;
  const posRef = useRef(positions);
  posRef.current = positions;

  // 2.1.e-1: значения костей, которые поле РЕАЛЬНО отыграло (к ним доворочены грани). Приземление
  // запускаем по их РАСХОЖДЕНИЮ с актуальными state.dice — а не только по транзиентному событию
  // dice:rolled. Так грани авторитетны к серверу и в онлайне (свой и чужой бросок), независимо от
  // тайминга доставки события / ленивой загрузки 3D. Значения для доворота и так берём из state.dice.
  const playedValues = useRef<DieValue[]>(dice.map((d) => d.value));
  // Сигнатура значений — зависимость эффекта: он перезапускается при ИЗМЕНЕНИИ значений (а не на
  // каждый рендер, как было бы с самим массивом dice).
  const valuesSig = dice.map((d) => d.value).join(',');

  useEffect(() => {
    const ds = diceRef.current;
    const ps = posRef.current;
    const values = ds.map((d) => d.value);

    // Смена хода (после записи ядро сбрасывает кости): ПЛАВНО собираем кости в ровный ряд и
    // доворачиваем на значения ядра (свежие «1»). Без этого тело↔разметка рассинхронятся и у
    // следующего игрока на кубиках случайные числа.
    if (events.some((e) => e.type === 'turn:changed')) {
      active.current = true;
      for (let i = 0; i < bodies.current.length; i++) {
        const body = bodies.current[i];
        const handle = handles.current[i];
        const rt = runtimes.current[i];
        if (!body || !rt) continue;
        const p = ps[i];
        const tr = body.translation();
        rt.from.set(tr.x, tr.y, tr.z);
        rt.rest.set(p[0], DIE_HALF, p[2]);
        const r = body.rotation();
        rt.q0.set(r.x, r.y, r.z, r.w); // тело: от текущей позы к identity
        rt.pip0.copy(handle?.pipGroup?.quaternion ?? IDENTITY_Q); // точки: от текущей разметки к identity
        rt.t = 0;
        rt.phase = 'gather';
        rt.placement = 'free';
        if (handle) handle.pipMaterial.opacity = 1;
      }
      // Грани после gather ведут к свежим значениям (обычно «1») — фиксируем их как отыгранные,
      // чтобы diff не запустил поверх сбора лишний «бросок».
      playedValues.current = values;
      return;
    }

    // Бросок: пришло событие dice:rolled ИЛИ значения разошлись с отыгранными (онлайн / пропущенное
    // или скоалесцированное событие). Второй путь делает приземление авторитетным ПО ЗНАЧЕНИЯМ
    // (грани = state.dice), даже если событие потерялось; перекат кости в то же значение докрывает
    // событийный путь (косметика — её грань и так верна).
    const rolled =
      events.some((e) => e.type === 'dice:rolled') || valuesDiffer(playedValues.current, values);
    if (!rolled) return;
    // Фиксируем значения как отыгранные ДО раскрутки — повторный рендер с той же сигнатурой не запустит снова.
    playedValues.current = values;
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
          handle.root?.scale.setScalar(1); // брошенная — полный размер
        }
        const rt = runtimes.current[i];
        rt.phase = 'replay';
        rt.frame = 0;
        rt.acc = 0;
        rt.placement = 'free';
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
      rt.placement = 'free';
      handles.current[i]?.root?.scale.setScalar(1);
      if (LANDING_MODE === 'reveal' && handles.current[i]) {
        handles.current[i]!.pipMaterial.opacity = FLIGHT_OPACITY;
      }
      const t = makeThrow(ps[i]);
      body.setTranslation({ x: t.pos[0], y: t.pos[1], z: t.pos[2] }, true);
      body.setRotation({ x: t.rot[0], y: t.rot[1], z: t.rot[2], w: t.rot[3] }, true);
      body.setLinvel({ x: t.lin[0], y: t.lin[1], z: t.lin[2] }, true);
      body.setAngvel({ x: t.ang[0], y: t.ang[1], z: t.ang[2] }, true);
    }
  }, [events, valuesSig, setSettling, rapier]);

  // Nudge: косметический «подскок» лежащих костей в зоне броска на ТЕ ЖЕ значения ядра.
  // Предрасчёт от текущих поз → переразметка под значения → воспроизведение (как бросок,
  // но без re-roll: значения не меняются — честно и сетебезопасно).
  useEffect(() => {
    if (nudgeNonce === 0) return; // стартовое значение, не трясём
    const ds = diceRef.current;
    const idx: number[] = [];
    const throws: DieThrow[] = [];
    for (let i = 0; i < bodies.current.length; i++) {
      const body = bodies.current[i];
      const rt = runtimes.current[i];
      if (!body || !rt) continue;
      if (ds[i]?.held || rt.phase !== 'rest') continue; // только лежащие в игре кости
      const tr = body.translation();
      const r = body.rotation();
      throws.push(makeNudge([tr.x, tr.y, tr.z], [r.x, r.y, r.z, r.w]));
      idx.push(i);
    }
    if (idx.length === 0) return;
    active.current = true;
    throwTime.current = 0;
    setSettling(true);
    const recordings = predictThrows(rapier, throws);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      recs.current[i] = recordings[k];
      const handle = handles.current[i];
      if (handle) {
        relabelForFinal(handle, recordings[k].finalQuat, ds[i].value); // то же значение ядра
        handle.pipMaterial.opacity = 1;
        handle.root?.scale.setScalar(1);
      }
      const rt = runtimes.current[i];
      rt.phase = 'replay';
      rt.frame = 0;
      rt.acc = 0;
      rt.placement = 'free';
    }
  }, [nudgeNonce, setSettling, rapier]);

  useFrame((_, delta) => {
    const ds = diceRef.current;

    // Рядок отложенных (F4.4b): held едут в ряд (slot по порядку held-индексов, ряд смыкается),
    // снятые возвращаются в зону броска. Кинематика, всегда; ориентацию/значение не трогаем.
    let heldCount = 0;
    for (let i = 0; i < bodies.current.length; i++) if (ds[i]?.held) heldCount++;
    let order = 0;
    for (let i = 0; i < bodies.current.length; i++) {
      const body = bodies.current[i];
      const rt = runtimes.current[i];
      if (!body || !rt) continue;
      const held = !!ds[i]?.held;
      const handle = handles.current[i];
      if (rt.phase === 'rest') {
        // Масштаб тянем к цели КАЖДЫЙ кадр (held → скромнее, иначе → полный 1). Самовосста-
        // новление: вернувшаяся/свободная кость гарантированно возвращает стандартный размер.
        lerpScale(handle, held ? KEPT_SCALE : 1, delta);
        if (held) {
          keptSlot(order, heldCount, _tp);
          moveToward(body, _tp, delta);
          rt.placement = 'kept';
        } else if (rt.placement === 'kept') {
          const p = posRef.current[i];
          _tp.set(p[0], DIE_HALF, p[2]);
          if (moveToward(body, _tp, delta)) rt.placement = 'free';
        }
      }
      if (held) order++;
    }

    if (!active.current) return;
    throwTime.current += delta;
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
      } else if (rt.phase === 'gather') {
        // Плавный сбор на новый ход: позиция → ряд, тело → identity, точки → identity, масштаб → 1.
        // Верхняя грань мягко «докатывается» от прежнего значения к «1» (без резкого скачка).
        allRest = false;
        rt.t = Math.min(1, rt.t + delta / GATHER_TIME);
        const e = easeOutCubic(rt.t);
        _p.copy(rt.from).lerp(rt.rest, e);
        body.setTranslation({ x: _p.x, y: _p.y, z: _p.z }, true);
        _R.copy(rt.q0).slerp(IDENTITY_Q, e);
        body.setRotation(_R, true);
        body.setLinvel(ZERO, false);
        body.setAngvel(ZERO, false);
        if (handle?.pipGroup) handle.pipGroup.quaternion.copy(rt.pip0).slerp(IDENTITY_Q, e);
        lerpScale(handle, 1, delta);
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
          dieRef={(el) => (handles.current[i] = el)}
          position={p}
          value={dice[i].value}
          onSelect={canHold ? () => toggleHold(i) : undefined}
        />
      ))}
    </>
  );
}
