import { createContext, useContext } from 'react';
import { RoundedBox } from '@react-three/drei/core/RoundedBox';

const Layer = createContext(undefined);
const palette = { white: '#fff9e8' };
export function Block({ size, color, position, radius = 0.06, ...props }) {
  const order = useContext(Layer);
  return (
    <RoundedBox
      renderOrder={order}
      args={size}
      radius={radius}
      smoothness={2}
      position={position}
      castShadow={order === undefined}
      receiveShadow={order === undefined}
      {...props}
    >
      <meshStandardMaterial transparent={order !== undefined} color={color} roughness={0.8} />
    </RoundedBox>
  );
}

export function Ball({ size = 0.2, color, position, scale, ...props }) {
  const order = useContext(Layer);
  return (
    <mesh
      renderOrder={order}
      position={position}
      scale={scale}
      castShadow={order === undefined}
      {...props}
    >
      <sphereGeometry args={[size, 16, 12]} />
      <meshStandardMaterial transparent={order !== undefined} color={color} roughness={0.65} />
    </mesh>
  );
}

export function Cylinder({ radii = [0.3, 0.3], height = 0.1, color, position, ...props }) {
  const order = useContext(Layer);
  return (
    <mesh
      renderOrder={order}
      position={position}
      castShadow={order === undefined}
      receiveShadow={order === undefined}
      {...props}
    >
      <cylinderGeometry args={[...radii, height, 24]} />
      <meshStandardMaterial transparent={order !== undefined} color={color} roughness={0.55} />
    </mesh>
  );
}

export function Tomato({ position = [0, 0, 0], scale = 1, color = '#e85945' }) {
  return (
    <group position={position} scale={scale}>
      <Ball size={0.23} color={color} scale={[1, 0.86, 1]} />
      <Cylinder radii={[0.02, 0.13]} height={0.12} color="#407b47" position={[0, 0.2, 0]} />
      <Ball size={0.055} color="#ffae8a" position={[-0.1, 0.1, 0.16]} />
    </group>
  );
}

export function Food({ item, burnt = false }) {
  if (item === 'tomato') return <Tomato />;
  if (item === 'chopped')
    return (
      <group>
        {[-0.15, 0, 0.15].map((x) => (
          <Block
            key={x}
            size={[0.13, 0.12, 0.24]}
            color="#e85945"
            position={[x, 0, 0]}
            radius={0.025}
          />
        ))}
      </group>
    );
  return (
    <group>
      <Cylinder radii={[0.46, 0.36]} height={item === 'soup' ? 0.22 : 0.06} color={palette.white} />
      {item === 'dish' && (
        <>
          {[-0.23, 0, 0.23].map((x, i) => (
            <Ball
              key={x}
              color={i % 2 ? '#97bc48' : '#5c943b'}
              size={0.22}
              scale={[1, 0.32, 1.2]}
              position={[x, 0.1, i % 2 ? -0.13 : 0.1]}
            />
          ))}
          {[-0.17, 0.17].map((x) => (
            <group key={x} position={[x, 0.16, 0]}>
              <Cylinder radii={[0.14, 0.14]} height={0.07} color="#e85945" />
              <Cylinder radii={[0.1, 0.1]} height={0.01} color="#f69b60" position={[0, 0.041, 0]} />
            </group>
          ))}
        </>
      )}
      {item === 'soup' && (
        <>
          <Cylinder radii={[0.32, 0.32]} height={0.02} color="#df7440" position={[0, 0.115, 0]} />
          <Ball size={0.05} color="#6e954c" position={[0.04, 0.145, 0.08]} />
        </>
      )}
      {item === 'roast' && (
        <>
          {[-0.2, 0.2].map((x, i) => (
            <group key={x} position={[x, 0.12, i ? -0.08 : 0.08]} rotation={[0, i ? 0.2 : -0.3, 0]}>
              <Ball size={0.22} scale={[1, 0.6, 1]} color={burnt ? '#50342b' : '#b64328'} />
              <Cylinder
                radii={[0.2, 0.2]}
                height={0.025}
                color={burnt ? '#352a22' : '#ea8350'}
                position={[0, 0.11, 0]}
              />
              {[-0.08, 0.04].map((z) => (
                <Block
                  key={z}
                  size={[0.31, 0.012, 0.025]}
                  radius={0.005}
                  color={burnt ? '#1e1a15' : '#70392b'}
                  position={[0, 0.13, z]}
                />
              ))}
            </group>
          ))}
          <Ball
            size={0.09}
            scale={[1, 0.25, 1.7]}
            color={burnt ? '#65593b' : '#557d36'}
            position={[0.05, 0.09, 0.26]}
          />
        </>
      )}
    </group>
  );
}

export function ProductPreview({ item, size = 40, order }) {
  return (
    <Layer.Provider value={order}>
      <group scale={size} rotation={[0.7, -0.35, 0]}>
        <Food item={item} />
      </group>
    </Layer.Provider>
  );
}
