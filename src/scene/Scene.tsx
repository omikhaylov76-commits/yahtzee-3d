import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, RoundedBox } from '@react-three/drei';
import type { Mesh } from 'three';

/**
 * Скелет F0: одна 3D-кость на «столе» с мягким светом и тенью, в палитре Auros.
 * Кость медленно вращается — чтобы сразу было видно, что 3D-стек живой.
 * Грани с точками (pips), физика броска и материалы «дорого» — в фиче F4.
 */
function Die() {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.x += delta * 0.4;
    ref.current.rotation.y += delta * 0.55;
  });

  return (
    <RoundedBox
      ref={ref}
      args={[1.4, 1.4, 1.4]}
      radius={0.18}
      smoothness={6}
      castShadow
      position={[0, 0.9, 0]}
    >
      <meshStandardMaterial color="#edfffe" roughness={0.35} metalness={0.15} />
    </RoundedBox>
  );
}

export function Scene() {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [3.2, 2.6, 4.2], fov: 42 }}>
      <color attach="background" args={['#012624']} />
      <fog attach="fog" args={['#012624', 8, 18]} />

      {/* Освещение: мягкий заполняющий + направленный с тенью */}
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[4, 7, 5]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[-4, 3, -4]} intensity={0.4} color="#00827c" />

      <Die />

      {/* «Стол» */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#011d1c" roughness={0.9} metalness={0} />
      </mesh>

      {/* Мягкая контактная тень под костью */}
      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.55}
        scale={12}
        blur={2.4}
        far={6}
        color="#000000"
      />
    </Canvas>
  );
}
