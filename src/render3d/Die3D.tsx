import { RoundedBox } from '@react-three/drei';
import { AUROS, DIE_SIZE } from './constants';
import { pipPositions } from './dieGeometry';

/** Позиции пипсов считаем один раз на модуль (геометрия не меняется). */
const PIPS = pipPositions();

/** Тёмные пипсы — высокий контраст на светлом кубике (читаемость, a11y). */
const PIP_COLOR = '#04201f';

/**
 * Визуальный кубик (F4.2): скруглённое тело в палитре Auros + 21 пип на гранях.
 * Без физики и без значения — ориентацию задаёт обёртка (PhysicsDie / VALUE_ROTATION).
 */
export function Die3D() {
  return (
    <group>
      <RoundedBox
        args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]}
        radius={0.1}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={AUROS.die} roughness={0.32} metalness={0.16} />
      </RoundedBox>

      {PIPS.map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <sphereGeometry args={[0.075, 16, 16]} />
          <meshStandardMaterial color={PIP_COLOR} roughness={0.5} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
}
