import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { AUROS } from './constants';

/** Полуразмер игровой зоны по X и Z — в этих пределах кости удерживаются бортиками. */
const ARENA_X = 4;
const ARENA_Z = 3;
/** Высота невидимых бортиков (полувысота коллайдера). */
const WALL_H = 3;

/**
 * «Стол» арены (F4.1): видимая поверхность + физика.
 * Физика — статичное тело: пол (кубоид-коллайдер, верхняя грань на y=0) и четыре
 * невидимых бортика, чтобы брошенные кости не улетали за пределы кадра.
 */
export function Table() {
  return (
    <>
      {/* Видимая поверхность стола */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color={AUROS.table} roughness={0.9} metalness={0} />
      </mesh>

      {/* Статичная физика: пол + бортики (невидимые) */}
      <RigidBody type="fixed" colliders={false} friction={0.85} restitution={0.15}>
        {/* Пол: толстый кубоид, верхняя грань ровно на y=0 */}
        <CuboidCollider args={[20, 0.5, 20]} position={[0, -0.5, 0]} />
        {/* Бортики по периметру арены */}
        <CuboidCollider args={[0.5, WALL_H, ARENA_Z]} position={[-ARENA_X, WALL_H, 0]} />
        <CuboidCollider args={[0.5, WALL_H, ARENA_Z]} position={[ARENA_X, WALL_H, 0]} />
        <CuboidCollider args={[ARENA_X, WALL_H, 0.5]} position={[0, WALL_H, -ARENA_Z]} />
        <CuboidCollider args={[ARENA_X, WALL_H, 0.5]} position={[0, WALL_H, ARENA_Z]} />
      </RigidBody>
    </>
  );
}
