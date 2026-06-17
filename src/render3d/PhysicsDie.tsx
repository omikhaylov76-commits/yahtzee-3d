import { forwardRef, useRef, type Ref } from 'react';
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
  /** Клик/тап по кости (фиксация). Если не задан — кость некликабельна. */
  onSelect?: () => void;
  /** Ref на визуал кости (группа точек + материал) — для режима «проявление». */
  dieRef?: Ref<DieHandle>;
}

/**
 * Одна физическая кость (F4.4): кубик с пипсами в Rapier-теле. Наружу прокидываются два ref:
 * само тело (бросок/воспроизведение) и визуал точек. Клик по кубику фиксирует/освобождает
 * (когда `onSelect` задан). Коллайдер задаём явно по ребру — выпуклые пипсы его не «раздувают».
 */
export const PhysicsDie = forwardRef<RapierRigidBody, PhysicsDieProps>(function PhysicsDie(
  { position, value, onSelect, dieRef },
  ref,
) {
  // Стартовый поворот фиксируем на момент монтирования. Иначе при смене value (сброс костей
  // на новый ход) меняется проп rotation, и @react-three/rapier переустанавливает позу тела —
  // тело крутится, а разметка точек остаётся старой → случайные значения. Ориентацией дальше
  // полностью правит DiceField.
  const initialRotation = useRef(VALUE_ROTATION[value]).current;
  return (
    <RigidBody
      ref={ref}
      colliders={false}
      position={position}
      rotation={initialRotation}
      friction={0.85}
      restitution={0.15}
    >
      <group
        onClick={(e) => {
          if (!onSelect) return;
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={() => {
          if (onSelect) document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
      >
        <Die3D ref={dieRef} />
      </group>
      <CuboidCollider args={[DIE_HALF, DIE_HALF, DIE_HALF]} />
    </RigidBody>
  );
});
