import { RoundedBox } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import { AUROS, DIE_SIZE } from './constants';

interface PhysicsDieProps {
  /** Стартовая позиция в мире. */
  position: [number, number, number];
}

/**
 * Одна физическая кость (F4.1): скруглённый кубик в Rapier-теле, лежит на столе.
 * Пока без пипсов и без значений ядра — грани с точками добавим в F4.2, бросок и
 * приземление на значение ядра — в F4.3.
 */
export function PhysicsDie({ position }: PhysicsDieProps) {
  return (
    <RigidBody colliders="cuboid" position={position} friction={0.85} restitution={0.15}>
      <RoundedBox args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]} radius={0.1} smoothness={5} castShadow>
        <meshStandardMaterial color={AUROS.die} roughness={0.35} metalness={0.15} />
      </RoundedBox>
    </RigidBody>
  );
}
