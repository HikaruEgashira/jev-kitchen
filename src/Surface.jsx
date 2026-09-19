import { Billboard } from '@react-three/drei/core/Billboard';
import { ScreenSizer } from '@react-three/drei/core/ScreenSizer';
import { RoundedBox } from '@react-three/drei/core/RoundedBox';
import { createContext, useContext } from 'react';
import { useThree } from '@react-three/fiber';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { defineTextMaterial } from '@pmndrs/glyph/three';

export const INK = '#245e50';
export const PAPER = '#fff9e8';
export const WOOD = '#b68050';
export const prepareFont = () => useMsdf.preload('/fonts/kitchen.font.glb', { emSize: 32 });
export const resetFont = () => useMsdf.clear('/fonts/kitchen.font.glb', { emSize: 32 });
const Font = createContext(null);
export function Typography({ children }) {
  const font = useMsdf('/fonts/kitchen.font.glb', { emSize: 32 });
  return <Font value={font}>{children}</Font>;
}
const letteringMaterial = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  return material;
});

export function Lettering({ text, width, height = 32, size = 16, color = INK, order = 1002 }) {
  const font = useContext(Font);
  const lines = String(text).split('\n').length;
  const lineHeight = Math.min(1.5, height / (size * lines));
  return (
    <Text
      font={font}
      material={letteringMaterial}
      renderOrder={order}
      position={[-width / 2, (size * lines * lineHeight) / 2, 0]}
      constraints={{ width: { mode: 'exact', size: width } }}
      layout={{ align: 'center', wrap: 'none', overflow: 'ellipsis' }}
      style={{ fontSize: size, lineHeight, color }}
      raycast={() => null}
    >
      {text}
    </Text>
  );
}

export function Plaque({
  width,
  height,
  color = PAPER,
  edge = WOOD,
  order = 1000,
  children,
  ...events
}) {
  return (
    <group {...events}>
      <RoundedBox
        args={[width, height, 6]}
        radius={Math.min(8, height / 4)}
        smoothness={2}
        renderOrder={order}
      >
        <meshBasicMaterial
          color={edge}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </RoundedBox>
      <RoundedBox
        args={[width - 4, height - 5, 4]}
        position={[0, 2, 3]}
        radius={Math.min(6, height / 5)}
        smoothness={2}
        renderOrder={order + 1}
      >
        <meshBasicMaterial
          color={color}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </RoundedBox>
      <group position={[0, 2, 6]}>{children}</group>
    </group>
  );
}

export function WorldLabel({
  position,
  text,
  width = 70,
  color = PAPER,
  progress,
  danger = false,
  visible = true,
  onClick,
}) {
  const narrow = useThree((s) => s.size.width < 600);
  const labelWidth = narrow ? width * 0.8 : width;
  const labelHeight = narrow ? 28 : 36;
  return (
    <Billboard position={position} visible={visible}>
      <ScreenSizer>
        <Plaque
          width={labelWidth}
          height={labelHeight}
          color={color}
          edge={danger ? '#ba443c' : WOOD}
          onClick={onClick}
        >
          <Lettering
            text={text}
            width={labelWidth - 6}
            height={labelHeight - 4}
            size={narrow ? 11 : 14}
          />
          {progress != null && (
            <mesh
              position={[(-(labelWidth - 12) * (1 - progress)) / 2, -labelHeight / 2 + 5, 1]}
              renderOrder={1003}
              raycast={() => null}
            >
              <planeGeometry args={[Math.max(0.1, (labelWidth - 12) * progress), 4]} />
              <meshBasicMaterial
                color={danger ? '#ba443c' : INK}
                transparent
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          )}
        </Plaque>
      </ScreenSizer>
    </Billboard>
  );
}
