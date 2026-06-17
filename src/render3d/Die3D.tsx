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
  /** Корневая группа визуала — масштабируем для скромного вида отложенных (F4.4b). */
  root: Group | null;
  pipGroup: Group | null;
  pipMaterial: MeshStandardMaterial;
}

/**
 * Визуальный кубик (F4.3): тело Auros + 21 пип на гранях. Точки вынесены в отдельную группу
 * с общим прозрачным материалом — так их можно переназначать (поворот группы) и проявлять
 * (opacity) независимо от физического тела.
 */
export const Die3D = forwardRef<DieHandle>(function Die3D(_, ref) {
  const root = useRef<Group>(null);
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
      get root() {
        return root.current;
      },
      get pipGroup() {
        return pipGroup.current;
      },
      pipMaterial,
    }),
    [pipMaterial],
  );

  return (
    <group ref={root}>
      <RoundedBox
        args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]}
        radius={0.1}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={AUROS.die} roughness={0.32} metalness={0.16} />
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
