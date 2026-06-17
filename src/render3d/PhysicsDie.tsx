import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { DieValue } from '../core';
import { DIE_HALF } from './constants';
import { Die3D } from './Die3D';
import { VALUE_ROTATION } from './dieGeometry';

interface PhysicsDieProps {
  /** Стартовая позиция в мире. */
  position: [number, number, number];
  /** Значение из ядра — задаёт, какая грань смотрит вверх (F4.2). */
  value: DieValue;
}

/**
 * Одна физическая кость (F4.2): кубик с пипсами в Rapier-теле, повёрнут нужной гранью вверх.
 * Коллайдер задаём явно по ребру кубика, чтобы выпуклые пипсы его не «раздували».
 * Бросок и приземление на значение ядра — в F4.3.
 */
export function PhysicsDie({ position, value }: PhysicsDieProps) {
  return (
    <RigidBody
      colliders={false}
      position={position}
      rotation={VALUE_ROTATION[value]}
      friction={0.85}
      restitution={0.15}
    >
      <Die3D />
      <CuboidCollider args={[DIE_HALF, DIE_HALF, DIE_HALF]} />
    </RigidBody>
  );
}
