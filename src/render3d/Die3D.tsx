import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import { Group, MeshStandardMaterial } from 'three';
import { AUROS, DIE_SIZE } from './constants';
import { pipPositions } from './dieGeometry';

/** Позиции пипсов считаем один раз на модуль (геометрия не меняется). */
const PIPS = pipPositions();

/** Тёмные пипсы — высокий контраст на светлом кубике (читаемость, a11y). */
const PIP_COLOR = '#04201f';

/**
 * Императивный доступ к визуалу кости (для DiceField):
 * - `pipGroup` крутим, чтобы вывести нужное значение вверх БЕЗ поворота тела («проявление»);
 * - `pipMaterial.opacity` гасим/проявляем точки в зависимости от скорости полёта.
 */
export interface DieHandle {
  pipGroup: Group | null;
  pipMaterial: MeshStandardMaterial;
}

/**
 * Визуальный кубик (F4.3): тело Auros + 21 пип на гранях. Точки вынесены в отдельную группу
 * с общим прозрачным материалом — так их можно переназначать (поворот группы) и проявлять
 * (opacity) независимо от физического тела.
 */
export const Die3D = forwardRef<DieHandle, { held?: boolean }>(function Die3D(
  { held = false },
  ref,
) {
  const pipGroup = useRef<Group>(null);
  const pipMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: PIP_COLOR,
        roughness: 0.5,
        metalness: 0.1,
        transparent: true,
        opacity: 1,
      }),
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      get pipGroup() {
        return pipGroup.current;
      },
      pipMaterial,
    }),
    [pipMaterial],
  );

  return (
    // Held: лёгкое увеличение всего кубика (равномерно, не зависит от ориентации тела).
    <group scale={held ? 1.06 : 1}>
      <RoundedBox
        args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]}
        radius={0.1}
        smoothness={5}
        castShadow
        receiveShadow
      >
        {/* Held: тёплое лиловое свечение Auros как видимый отклик фиксации. */}
        <meshStandardMaterial
          color={AUROS.die}
          roughness={0.32}
          metalness={0.16}
          emissive={held ? '#fde9ff' : '#000000'}
          emissiveIntensity={held ? 0.45 : 0}
        />
      </RoundedBox>

      <group ref={pipGroup}>
        {PIPS.map((p, i) => (
          <mesh key={i} position={p} material={pipMaterial} castShadow>
            <sphereGeometry args={[0.075, 16, 16]} />
          </mesh>
        ))}
      </group>
    </group>
  );
});
