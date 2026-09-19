import { Billboard } from '@react-three/drei/core/Billboard';
import { ScreenSizer } from '@react-three/drei/core/ScreenSizer';
import { RoundedBox } from '@react-three/drei/core/RoundedBox';
import { createContext, useContext } from 'react';
import { useThree } from '@react-three/fiber';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { compactControls } from './ui.js';

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
  progress = null,
  progressColor = INK,
  progressOpacity = 0.34,
  children,
  ...events
}) {
  const innerWidth = width - 4;
  const innerHeight = height - 5;
  const fill = progress == null ? 0 : innerHeight * Math.min(1, Math.max(0, progress));
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
        args={[innerWidth, innerHeight, 4]}
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
      {fill > 0.5 && (
        <RoundedBox
          args={[innerWidth, fill, 4]}
          position={[0, 2 - (innerHeight - fill) / 2, 4]}
          radius={Math.min(6, fill / 2)}
          smoothness={2}
          renderOrder={order + 1}
        >
          <meshBasicMaterial
            color={progressColor}
            transparent
            opacity={progressOpacity}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </RoundedBox>
      )}
      <group position={[0, 2, 6]}>{children}</group>
    </group>
  );
}

// Horizontal meter used to visualize relative staff performance without raw numbers.
export function Meter({ width, height, ratio = 0, color = INK, track = '#dbe3d2', order = 1000 }) {
  const inner = Math.max(1, width - 4);
  const fill = Math.max(height - 4, inner * Math.min(1, Math.max(0, ratio)));
  return (
    <group>
      <RoundedBox args={[width, height, 4]} radius={height / 2} smoothness={2} renderOrder={order}>
        <meshBasicMaterial
          color={track}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </RoundedBox>
      <RoundedBox
        args={[fill, height - 4, 4]}
        radius={(height - 4) / 2}
        smoothness={2}
        position={[-(inner - fill) / 2, 0, 2]}
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
  const narrow = useThree((s) => compactControls(s.size.width, s.size.height));
  const labelWidth = narrow ? width * 0.8 : width;
  const labelHeight = narrow ? 24 : 30;
  return (
    <Billboard position={position} visible={visible}>
      <ScreenSizer>
        <Plaque
          width={labelWidth}
          height={labelHeight}
          color={color}
          edge={danger ? '#ba443c' : WOOD}
          progress={progress}
          progressColor={danger ? '#ba443c' : INK}
          progressOpacity={danger ? 0.42 : 0.34}
          onClick={onClick}
        >
          <Lettering
            text={text}
            width={labelWidth - 6}
            height={labelHeight - 4}
            size={narrow ? 11 : 12}
          />
        </Plaque>
      </ScreenSizer>
    </Billboard>
  );
}
