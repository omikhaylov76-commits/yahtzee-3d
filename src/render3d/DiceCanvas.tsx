import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import type { Die } from '../core';
import { AUROS, DIE_HALF } from './constants';
import { Table } from './Table';
import { DiceField } from './DiceField';

interface DiceCanvasProps {
  /** Состояние костей из ядра — пока используем только их количество (5). */
  dice: Die[];
}

/** Раскладка костей ровным рядом по центру стола. */
function layout(count: number): [number, number, number][] {
  const gap = 1.2;
  const start = -((count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) => [start + i * gap, DIE_HALF + 0.05, 0]);
}

/**
 * 3D-арена костей (F4.1): R3F-сцена с физикой Rapier, столом, светом и тенями в палитре
 * Auros. Показывает 5 костей, покоящихся на столе. Бросок/значения/фиксация — F4.2–F4.4.
 */
export function DiceCanvas({ dice }: DiceCanvasProps) {
  const positions = layout(dice.length);
  return (
    <Canvas
      className="dice-canvas"
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 5, 6.5], fov: 42 }}
    >
      <color attach="background" args={[AUROS.bg]} />
      <fog attach="fog" args={[AUROS.bg, 10, 22]} />

      {/* Свет: мягкий заполняющий + направленный с тенью + холодный акцент */}
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[4, 8, 5]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[-5, 4, -4]} intensity={0.4} color={AUROS.accent} />

      <Suspense fallback={null}>
        <Physics>
          <Table />
          <DiceField dice={dice} positions={positions} />
        </Physics>
      </Suspense>

      {/* Мягкая контактная тень под костями */}
      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.5}
        scale={16}
        blur={2.6}
        far={6}
        color="#000000"
      />
    </Canvas>
  );
}
