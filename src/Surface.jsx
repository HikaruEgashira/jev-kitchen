import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei/core/RoundedBox';
import * as THREE from 'three/webgpu';

export const INK = '#245e50';
export const PAPER = '#fff9e8';
export const WOOD = '#b68050';
export const FONT = '"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';

// Rasterize only glyphs. Panels, controls, hit targets and their depth live in Three.
export function Lettering({ text, width, height = 32, size = 16, color = INK, order = 1002 }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * 2);
    canvas.height = Math.ceil(height * 2);
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.generateMipmaps = false;
    result.minFilter = THREE.LinearFilter;
    return result;
  }, [width, height]);
  useLayoutEffect(() => {
    const canvas = texture.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(2, 2);
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = String(text).split('\n');
    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        width / 2,
        height / 2 + (index - (lines.length - 1) / 2) * size * 1.5,
        width - 8,
      );
    });
    ctx.restore();
    texture.needsUpdate = true;
  }, [texture, text, size, color, width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh renderOrder={order} raycast={() => null}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
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
  const group = useRef();
  useFrame(({ camera }) => {
    group.current.quaternion.copy(camera.quaternion);
    group.current.scale.setScalar(1 / camera.zoom);
  });
  return (
    <group ref={group} position={position} visible={visible}>
      <Plaque
        width={width}
        height={36}
        color={color}
        edge={danger ? '#ba443c' : WOOD}
        onClick={onClick}
      >
        <Lettering text={text} width={width - 6} size={14} />
        {progress != null && (
          <mesh
            position={[(-(width - 12) * (1 - progress)) / 2, -13, 1]}
            renderOrder={1003}
            raycast={() => null}
          >
            <planeGeometry args={[Math.max(0.1, (width - 12) * progress), 4]} />
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
    </group>
  );
}
