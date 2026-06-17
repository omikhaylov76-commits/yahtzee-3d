import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { ARENA, AUROS, PHYS } from './constants';

/**
 * «Стол» арены (F4.1): видимая поверхность + физика.
 * Параметры зоны/физики берём из общих констант (ARENA/PHYS) — теми же пользуется
 * headless-предсказатель, иначе предсказание грани разойдётся с показом.
 */
export function Table() {
  const x = ARENA.halfX;
  const z = ARENA.halfZ;
  const h = ARENA.wallHalfH;
  return (
    <>
      {/* Видимая поверхность стола */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color={AUROS.table} roughness={0.9} metalness={0} />
      </mesh>

      {/* Статичная физика: пол + бортики (невидимые) */}
      <RigidBody
        type="fixed"
        colliders={false}
        friction={PHYS.friction}
        restitution={PHYS.restitution}
      >
        {/* Пол: толстый кубоид, верхняя грань ровно на y=0 */}
        <CuboidCollider args={[20, ARENA.floorHalfY, 20]} position={[0, -ARENA.floorHalfY, 0]} />
        {/* Бортики по периметру арены */}
        <CuboidCollider args={[0.5, h, z]} position={[-x, h, 0]} />
        <CuboidCollider args={[0.5, h, z]} position={[x, h, 0]} />
        <CuboidCollider args={[x, h, 0.5]} position={[0, h, -z]} />
        <CuboidCollider args={[x, h, 0.5]} position={[0, h, z]} />
      </RigidBody>
    </>
  );
}
