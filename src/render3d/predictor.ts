/**
 * Headless-предсказатель броска (F4.3b, вариант A).
 *
 * По стартовым условиям броска прогоняет ОТДЕЛЬНЫЙ физический мир (зеркало видимой арены) и
 * ЗАПИСЫВАЕТ траекторию каждой кости по шагам + финальную ориентацию. Видимая сцена потом
 * просто воспроизводит запись — поэтому значение всегда из ядра (ADR-0004), физика только
 * показывает, а «живой» мир не может разойтись с предсказанием (дрейфа нет — одна симуляция).
 *
 * Кости симулируются ВМЕСТЕ в одном мире — столкновения костей друг о друга реальны.
 */
import type { useRapier } from '@react-three/rapier';
import { ARENA, DIE_HALF, PHYS } from './constants';

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
  /** Кадры по шагам физики: [x, y, z, qx, qy, qz, qw]. */
  frames: number[][];
  /** Финальная ориентация (кватернион xyzw) — на неё переразмечаем точки. */
  finalQuat: Quat;
}

const MAX_STEPS = 260; // ~4.3 c при 1/60 — страховка
const MIN_STEPS = 24; // не выходим раньше, даже если «уснули» мгновенно

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
  addBox(ARENA.halfX, ARENA.wallHalfH, 0.5, 0, ARENA.wallHalfH, ARENA.frontZ);

  // Кости.
  const bodies = throws.map((t) => {
    const desc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(t.pos[0], t.pos[1], t.pos[2])
      .setRotation({ x: t.rot[0], y: t.rot[1], z: t.rot[2], w: t.rot[3] })
      .setLinvel(t.lin[0], t.lin[1], t.lin[2])
      .setAngvel({ x: t.ang[0], y: t.ang[1], z: t.ang[2] });
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

  for (let s = 0; s < MAX_STEPS; s++) {
    world.step();
    let allSleeping = true;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const p = b.translation();
      const r = b.rotation();
      recordings[i].frames.push([p.x, p.y, p.z, r.x, r.y, r.z, r.w]);
      if (!b.isSleeping()) allSleeping = false;
    }
    if (s >= MIN_STEPS && allSleeping) break;
  }

  for (let i = 0; i < bodies.length; i++) {
    const frames = recordings[i].frames;
    const f = frames[frames.length - 1];
    recordings[i].finalQuat = [f[3], f[4], f[5], f[6]];
  }

  world.free();
  return recordings;
}
