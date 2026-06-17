import { useMemo } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { ARENA, PHYS } from './constants';

/**
 * Процедурная текстура поверхности стола: радиальный «омут света» в палитре Auros —
 * тёплый бирюзовый центр под игровой зоной, плавно гаснущий к тёмным краям (под фон).
 * Генерируем в коде (без внешних ассетов/лицензий).
 */
function makeTableTexture(): CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.02,
    size / 2,
    size / 2,
    size * 0.5,
  );
  g.addColorStop(0, '#12564c'); // освещённый центр
  g.addColorStop(0.18, '#0b423b');
  g.addColorStop(0.4, '#06302a');
  g.addColorStop(0.62, '#03201e'); // тёмные края (около фона)
  g.addColorStop(1, '#03201e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * «Стол» арены: видимая поверхность с «омутом света» (кости лежат на читаемом столе, не парят)
 * + физика. Параметры зоны/физики — из общих констант (ARENA/PHYS), как у предсказателя.
 */
export function Table() {
  const tex = useMemo(makeTableTexture, []);
  const x = ARENA.halfX;
  const h = ARENA.wallHalfH;
  const midZ = (ARENA.backZ + ARENA.frontZ) / 2;
  const depthHalf = (ARENA.frontZ - ARENA.backZ) / 2;
  return (
    <>
      {/* Видимая поверхность стола: «омут света» центрирован под игровой зоной (z≈0.5) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.5]} receiveShadow>
        <planeGeometry args={[44, 44]} />
        <meshStandardMaterial map={tex} roughness={0.92} metalness={0.05} />
      </mesh>

      {/* Статичная физика: пол + бортики (невидимые) */}
      <RigidBody
        type="fixed"
        colliders={false}
        friction={PHYS.friction}
        restitution={PHYS.restitution}
      >
        <CuboidCollider args={[20, ARENA.floorHalfY, 20]} position={[0, -ARENA.floorHalfY, 0]} />
        <CuboidCollider args={[0.5, h, depthHalf]} position={[-x, h, midZ]} />
        <CuboidCollider args={[0.5, h, depthHalf]} position={[x, h, midZ]} />
        <CuboidCollider args={[x, h, 0.5]} position={[0, h, ARENA.backZ]} />
        <CuboidCollider args={[x, h, 0.5]} position={[0, h, ARENA.frontZ]} />
      </RigidBody>
    </>
  );
}
