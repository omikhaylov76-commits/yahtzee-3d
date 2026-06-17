/**
 * СПАЙК (F4.3a) — проверка осуществимости варианта A «предрасчёт броска + переразметка».
 * Вопрос: можно ли в нашем Rapier предсказать грань приземления headless-прогоном и затем
 * ВОСПРОИЗВЕСТИ тот же бросок (детерминизм + snapshot/restore)? Если да — A реализуем.
 *
 * Это разведочный тест: при выборе варианта A он либо переедет в нормальные тесты, либо
 * будет удалён. Ядра/игры не касается — чистая физика.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

type Quat = { x: number; y: number; z: number; w: number };

interface Throw {
  pos: [number, number, number];
  rot: Quat;
  lin: [number, number, number];
  ang: [number, number, number];
}

const DIE_HALF = 0.45;

function buildWorld(t: Throw) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setFriction(0.85).setRestitution(0.15),
    floor,
  );

  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(t.pos[0], t.pos[1], t.pos[2])
    .setRotation(t.rot)
    .setLinvel(t.lin[0], t.lin[1], t.lin[2])
    .setAngvel({ x: t.ang[0], y: t.ang[1], z: t.ang[2] });
  const die = world.createRigidBody(desc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(DIE_HALF, DIE_HALF, DIE_HALF).setFriction(0.85).setRestitution(0.15),
    die,
  );

  return { world, die };
}

/** Прогнать `steps` шагов, вернуть финальный кватернион кости. */
function simulate(t: Throw, steps = 300): Quat {
  const { world, die } = buildWorld(t);
  for (let i = 0; i < steps; i++) world.step();
  const r = die.rotation();
  return { x: r.x, y: r.y, z: r.z, w: r.w };
}

/** Повернуть вектор кватернионом. */
function applyQuat(q: Quat, v: { x: number; y: number; z: number }) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Какая локальная ось кости смотрит вверх (мир +Y) и насколько «плоско» она легла. */
function upAxis(rot: Quat) {
  const conj = { x: -rot.x, y: -rot.y, z: -rot.z, w: rot.w };
  const u = applyQuat(conj, { x: 0, y: 1, z: 0 });
  const ax = Math.abs(u.x);
  const ay = Math.abs(u.y);
  const az = Math.abs(u.z);
  let label: string;
  let mag: number;
  if (ax >= ay && ax >= az) {
    label = u.x > 0 ? '+X' : '-X';
    mag = ax;
  } else if (ay >= az) {
    label = u.y > 0 ? '+Y' : '-Y';
    mag = ay;
  } else {
    label = u.z > 0 ? '+Z' : '-Z';
    mag = az;
  }
  return { label, mag };
}

const THROWS: Throw[] = [
  { pos: [0, 2.6, 0], rot: { x: 0, y: 0, z: 0, w: 1 }, lin: [1.2, -2.5, -0.8], ang: [9, -4, 6] },
  {
    pos: [1.0, 3.0, -0.5],
    rot: { x: 0.2, y: 0.4, z: 0.1, w: 0.88 },
    lin: [-1.8, -3, 1.3],
    ang: [-7, 11, -3],
  },
  {
    pos: [-1.2, 2.8, 0.7],
    rot: { x: -0.3, y: 0.1, z: 0.5, w: 0.8 },
    lin: [0.6, -2, -1.6],
    ang: [4, 8, -10],
  },
];

describe('СПАЙК A: детерминизм броска Rapier', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('одинаковый старт → бит-в-бит одинаковая финальная ориентация (и грань)', () => {
    for (const t of THROWS) {
      const a = simulate(t);
      const b = simulate(t);
      expect(a.x).toBeCloseTo(b.x, 10);
      expect(a.y).toBeCloseTo(b.y, 10);
      expect(a.z).toBeCloseTo(b.z, 10);
      expect(a.w).toBeCloseTo(b.w, 10);
      expect(upAxis(a).label).toBe(upAxis(b).label);
    }
  });

  it('кости ложатся ПЛОСКО на грань (грань приземления однозначна)', () => {
    for (const t of THROWS) {
      const { label, mag } = upAxis(simulate(t));
      // mag≈1 => одна грань строго вверх (не угол) => предсказание грани надёжно
      expect(mag).toBeGreaterThan(0.999);
      expect(['+X', '-X', '+Y', '-Y', '+Z', '-Z']).toContain(label);
    }
  });

  it('snapshot/restore воспроизводит бросок (механизм видимого повтора)', () => {
    const t = THROWS[0];
    const { world, die } = buildWorld(t);
    for (let i = 0; i < 60; i++) world.step(); // частично проиграли
    const snap = world.takeSnapshot();

    for (let i = 0; i < 240; i++) world.step(); // доиграли «вживую»
    const live = die.rotation();

    const w2 = RAPIER.World.restoreSnapshot(snap); // восстановили из снимка
    const die2 = w2.getRigidBody(die.handle); // то же тело по handle
    for (let i = 0; i < 240; i++) w2.step(); // повтор
    const replay = die2.rotation();

    expect(replay.x).toBeCloseTo(live.x, 10);
    expect(replay.y).toBeCloseTo(live.y, 10);
    expect(replay.z).toBeCloseTo(live.z, 10);
    expect(replay.w).toBeCloseTo(live.w, 10);
    expect(upAxis(replay).label).toBe(upAxis(live).label);
  });
});
