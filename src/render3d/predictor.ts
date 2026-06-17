/**
 * Headless-предсказатель броска (вариант A) + ГАРАНТИЯ плоской укладки.
 *
 * Прогоняет отдельный физический мир (зеркало арены), записывает кувырок, затем
 * ДЕТЕРМИНИРОВАННО доводит кости: доворачивает каждую на ближайшую плоскую грань и
 * расталкивает по столу. Так после любого броска/нуджа все кости лежат ровно на гранях,
 * отдельно, без зависаний на ребре/углу/друг на друге. Видимая сцена воспроизводит запись →
 * значение всегда из ядра (ADR-0004), физика только показывает.
 */
import { Quaternion, Vector3 } from 'three';
import type { useRapier } from '@react-three/rapier';
import { ARENA, DIE_HALF, DIE_SIZE, PHYS } from './constants';

/** Namespace Rapier ровно в том виде, как его отдаёт useRapier() (тот же модуль/сборка). */
type RapierNS = ReturnType<typeof useRapier>['rapier'];
type Quat = [number, number, number, number];

export interface DieThrow {
  pos: [number, number, number];
  rot: Quat; // кватернион xyzw
  lin: [number, number, number];
  ang: [number, number, number];
}

export interface DieRecording {
  /** Кадры: [x, y, z, qx, qy, qz, qw] — кувырок + плавная доводка. */
  frames: number[][];
  /** Финальная (плоская) ориентация — на неё переразмечаем точки. */
  finalQuat: Quat;
}

const TUMBLE_MAX = 240; // макс. кадров физического кувырка
const MIN_STEPS = 20;
const SETTLE_LIN = 0.35; // скорость, ниже которой кувырок «почти затих»
const SETTLE_ANG = 0.5;
const QUIET_FRAMES = 6; // «тихо» подряд → заканчиваем физику
const PLACE_FRAMES = 40; // кадров плавной доводки (~0.67 c) — мягко, без рывка
const SEP = DIE_SIZE * 1.12; // мин. расстояние между центрами костей (не налезают)
const RELAX_ITERS = 16;

const WORLD_UP = new Vector3(0, 1, 0);
// smootherstep: нулевые скорость И ускорение на концах → мягкий вход/выход без скачка.
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function vlen(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Ближайшая координатная ось к вектору. */
function nearestAxis(d: Vector3): Vector3 {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return new Vector3(Math.sign(d.x) || 1, 0, 0);
  if (ay >= az) return new Vector3(0, Math.sign(d.y) || 1, 0);
  return new Vector3(0, 0, Math.sign(d.z) || 1);
}

/** Ближайшая «плоская» поза: минимальный доворот так, чтобы грань строго смотрела вверх. */
function flatQuat(q: Quaternion): Quaternion {
  const local = WORLD_UP.clone().applyQuaternion(q.clone().invert()); // worldUp в локальных осях тела
  const axis = nearestAxis(local); // локальная грань, что сейчас «вверх»
  const world = axis.applyQuaternion(q).normalize(); // её текущая мировая ось (с наклоном)
  const delta = new Quaternion().setFromUnitVectors(world, WORLD_UP); // минимальный доворот к +Y
  return delta.multiply(q);
}

export function predictThrows(rapier: RapierNS, throws: DieThrow[]): DieRecording[] {
  const world = new rapier.World({ x: 0, y: PHYS.gravityY, z: 0 });
  world.timestep = PHYS.timeStep;

  // Пол + бортики — зеркало видимого стола (общие константы ARENA/PHYS).
  const fixed = world.createRigidBody(rapier.RigidBodyDesc.fixed());
  const addBox = (hx: number, hy: number, hz: number, px: number, py: number, pz: number) =>
    world.createCollider(
      rapier.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(px, py, pz)
        .setFriction(PHYS.friction)
        .setRestitution(PHYS.restitution),
      fixed,
    );
  const midZ = (ARENA.backZ + ARENA.frontZ) / 2;
  const depthHalf = (ARENA.frontZ - ARENA.backZ) / 2;
  addBox(20, ARENA.floorHalfY, 20, 0, -ARENA.floorHalfY, 0);
  addBox(0.5, ARENA.wallHalfH, depthHalf, -ARENA.halfX, ARENA.wallHalfH, midZ);
  addBox(0.5, ARENA.wallHalfH, depthHalf, ARENA.halfX, ARENA.wallHalfH, midZ);
  addBox(ARENA.halfX, ARENA.wallHalfH, 0.5, 0, ARENA.wallHalfH, ARENA.backZ);
  // Передней стенки нет (бросок «от меня» в стол); финальный кламп зоны держит кости спереди.

  // Кости.
  const bodies = throws.map((t) => {
    const desc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(t.pos[0], t.pos[1], t.pos[2])
      .setRotation({ x: t.rot[0], y: t.rot[1], z: t.rot[2], w: t.rot[3] })
      .setLinvel(t.lin[0], t.lin[1], t.lin[2])
      .setAngvel({ x: t.ang[0], y: t.ang[1], z: t.ang[2] })
      .setLinearDamping(PHYS.linearDamping)
      .setAngularDamping(PHYS.angularDamping)
      .setCanSleep(false);
    const body = world.createRigidBody(desc);
    world.createCollider(
      rapier.ColliderDesc.cuboid(DIE_HALF, DIE_HALF, DIE_HALF)
        .setFriction(PHYS.friction)
        .setRestitution(PHYS.restitution),
      body,
    );
    return body;
  });

  const recordings: DieRecording[] = throws.map(() => ({ frames: [], finalQuat: [0, 0, 0, 1] }));

  // 1) Физический кувырок до затихания.
  let quiet = 0;
  for (let s = 0; s < TUMBLE_MAX; s++) {
    world.step();
    let allQuiet = true;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const p = b.translation();
      const r = b.rotation();
      recordings[i].frames.push([p.x, p.y, p.z, r.x, r.y, r.z, r.w]);
      if (vlen(b.linvel()) >= SETTLE_LIN || vlen(b.angvel()) >= SETTLE_ANG) allQuiet = false;
    }
    if (s >= MIN_STEPS && allQuiet) {
      if (++quiet >= QUIET_FRAMES) break;
    } else {
      quiet = 0;
    }
  }

  // 2) Цели доводки: плоская грань + отдельная позиция на столе.
  const fromPos: Vector3[] = [];
  const fromQuat: Quaternion[] = [];
  const toQuat: Quaternion[] = [];
  const pos: Vector3[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const fr = recordings[i].frames;
    const f = fr[fr.length - 1];
    fromPos.push(new Vector3(f[0], f[1], f[2]));
    const q = new Quaternion(f[3], f[4], f[5], f[6]);
    fromQuat.push(q);
    toQuat.push(flatQuat(q.clone()));
    pos.push(new Vector3(f[0], DIE_HALF, f[2]));
  }

  // Расталкивание (релаксация) — ни одна кость не на другой; удержание в пределах зоны.
  const minX = -ARENA.halfX + DIE_HALF;
  const maxX = ARENA.halfX - DIE_HALF;
  const minZ = ARENA.backZ + DIE_HALF;
  const maxZ = ARENA.frontZ - DIE_HALF;
  for (let it = 0; it < RELAX_ITERS; it++) {
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        let dx = pos[i].x - pos[j].x;
        let dz = pos[i].z - pos[j].z;
        let dist = Math.hypot(dx, dz);
        if (dist < SEP) {
          if (dist < 1e-4) {
            dx = i - j || 1; // ровно «стопкой» — разводим детерминированно
            dz = 0.5;
            dist = Math.hypot(dx, dz);
          }
          const push = (SEP - dist) / 2;
          const nx = dx / dist;
          const nz = dz / dist;
          pos[i].x += nx * push;
          pos[i].z += nz * push;
          pos[j].x -= nx * push;
          pos[j].z -= nz * push;
        }
      }
    }
    for (let i = 0; i < pos.length; i++) {
      pos[i].x = Math.min(maxX, Math.max(minX, pos[i].x));
      pos[i].z = Math.min(maxZ, Math.max(minZ, pos[i].z));
    }
  }

  // 3) Плавная доводка — дописываем кадры (easeOut) к (плоская грань, отдельное место).
  const _p = new Vector3();
  const _q = new Quaternion();
  for (let i = 0; i < bodies.length; i++) {
    for (let f = 1; f <= PLACE_FRAMES; f++) {
      const e = smootherstep(f / PLACE_FRAMES);
      _p.copy(fromPos[i]).lerp(pos[i], e);
      _q.copy(fromQuat[i]).slerp(toQuat[i], e);
      recordings[i].frames.push([_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w]);
    }
    recordings[i].finalQuat = [toQuat[i].x, toQuat[i].y, toQuat[i].z, toQuat[i].w];
  }

  world.free();
  return recordings;
}
