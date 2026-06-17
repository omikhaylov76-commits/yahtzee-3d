import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { VSMShadowMap } from 'three';
import type { Die } from '../core';
import { AUROS, DIE_HALF } from './constants';
import { Table } from './Table';
import { DiceField } from './DiceField';

interface DiceCanvasProps {
  /** Состояние костей из ядра (значения + held). */
  dice: Die[];
  /** Можно ли фиксировать кости кликом (прокидывается в DiceField). */
  canHold: boolean;
}

/** Раскладка костей ровным рядом по центру зоны броска. */
function layout(count: number): [number, number, number][] {
  const gap = 1.2;
  const start = -((count - 1) * gap) / 2;
  // z=0.3 — приземление броска чуть ближе ко мне и ниже по экрану, в центре внимания.
  return Array.from({ length: count }, (_, i) => [start + i * gap, DIE_HALF + 0.05, 0.3]);
}

/**
 * 3D-арена костей (F4.1): R3F-сцена с физикой Rapier, столом, светом и тенями в палитре
 * Auros. Показывает 5 костей, покоящихся на столе. Бросок/значения/фиксация — F4.2–F4.4.
 */
export function DiceCanvas({ dice, canHold }: DiceCanvasProps) {
  const positions = layout(dice.length);
  return (
    <Canvas
      className="dice-canvas"
      shadows={{ type: VSMShadowMap }}
      dpr={[1, 2]}
      camera={{ position: [0, 6.8, 5.7], fov: 44 }}
    >
      <color attach="background" args={[AUROS.bg]} />
      <fog attach="fog" args={[AUROS.bg, 10, 22]} />

      {/* Ключевой свет СВЕРХУ-СБОКУ: лепит светлую и теневую грань (объём, «скульптурность»);
          он же бросает мягкую тень (VSM, shadow-radius). */}
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[6, 10, 2.5]}
        intensity={1.35}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={1}
        shadow-camera-far={26}
        shadow-radius={18}
        shadow-blurSamples={28}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* Мягкий фил с теневой стороны — тёмная грань не проваливается в черноту (детали в тени) */}
      <directionalLight position={[-5, 5, 3]} intensity={0.22} />
      {/* Контровой rim сзади-сбоку — лёгкое премиальное сияние по краю костей */}
      <directionalLight position={[-5, 4.5, -5]} intensity={0.6} color="#a9f0ea" />
      {/* Слабый холодный атмосферный акцент */}
      <pointLight position={[-5, 4, -4]} intensity={0.2} color={AUROS.accent} />

      <Suspense fallback={null}>
        <Physics>
          <Table />
          <DiceField dice={dice} positions={positions} canHold={canHold} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
