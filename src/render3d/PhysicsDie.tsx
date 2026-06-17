import { forwardRef, type Ref } from 'react';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import type { DieValue } from '../core';
import { DIE_HALF } from './constants';
import { Die3D, type DieHandle } from './Die3D';
import { VALUE_ROTATION } from './dieGeometry';

interface PhysicsDieProps {
  /** Стартовая позиция в мире. */
  position: [number, number, number];
  /** Значение из ядра — задаёт начальную грань вверх (дальше ориентацией правит DiceField). */
  value: DieValue;
  /** Ref на визуал кости (группа точек + материал) — для режима «проявление». */
  dieRef?: Ref<DieHandle>;
}

/**
 * Одна физическая кость (F4.3): кубик с пипсами в Rapier-теле. Наружу прокидываются два ref:
 * само тело (бросок/доворот) и визуал точек (переназначение значения + проявление). Коллайдер
 * задаём явно по ребру кубика, чтобы выпуклые пипсы его не «раздували».
 */
export const PhysicsDie = forwardRef<RapierRigidBody, PhysicsDieProps>(function PhysicsDie(
  { position, value, dieRef },
  ref,
) {
  return (
    <RigidBody
      ref={ref}
      colliders={false}
      position={position}
      rotation={VALUE_ROTATION[value]}
      friction={0.85}
      restitution={0.15}
    >
      <Die3D ref={dieRef} />
      <CuboidCollider args={[DIE_HALF, DIE_HALF, DIE_HALF]} />
    </RigidBody>
  );
});
