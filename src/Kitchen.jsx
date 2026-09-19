import { Component, memo, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei/web/Html';
import { RoundedBox } from '@react-three/drei/core/RoundedBox';
import * as THREE from 'three/webgpu';
import { useKitchen, goTo, tick } from './game.js';
import { STATIONS, STATION_IDS, CHOP_MS, COOK_MS } from './model.js';

const world = (x, y, height = 0) => [(x - 450) / 65, height, (y - 270) / 65];
const palette = {
  mint: '#76b59b',
  green: '#245e50',
  coral: '#ed826e',
  yellow: '#f4cd75',
  white: '#fff9e8',
  wood: '#c89969',
  steel: '#a5bbb3',
};

function Block({ size, color, position, radius = 0.06, ...props }) {
  return (
    <RoundedBox
      args={size}
      radius={radius}
      smoothness={2}
      position={position}
      castShadow
      receiveShadow
      {...props}
    >
      <meshStandardMaterial color={color} roughness={0.8} />
    </RoundedBox>
  );
}

function Ball({ size = 0.2, color, position, scale, ...props }) {
  return (
    <mesh position={position} scale={scale} castShadow {...props}>
      <sphereGeometry args={[size, 16, 12]} />
      <meshStandardMaterial color={color} roughness={0.65} />
    </mesh>
  );
}

function Cylinder({ radii = [0.3, 0.3], height = 0.1, color, position, ...props }) {
  return (
    <mesh position={position} castShadow receiveShadow {...props}>
      <cylinderGeometry args={[...radii, height, 24]} />
      <meshStandardMaterial color={color} roughness={0.55} />
    </mesh>
  );
}

function Tomato({ position = [0, 0, 0], scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <Ball size={0.23} color="#e85945" scale={[1, 0.86, 1]} />
      <mesh position={[0, 0.2, 0]} rotation={[0, 0.35, 0]}>
        <coneGeometry args={[0.14, 0.12, 5]} />
        <meshStandardMaterial color="#407b47" />
      </mesh>
      <Ball size={0.055} color="#ffae8a" position={[-0.1, 0.1, 0.16]} />
    </group>
  );
}

function Food({ item }) {
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
      <Cylinder radii={[0.38, 0.3]} height={item === 'soup' ? 0.22 : 0.06} color={palette.white} />
      {item === 'dish' && (
        <>
          <Ball color="#72a744" size={0.26} scale={[1, 0.38, 1]} position={[0, 0.08, 0]} />
          <Tomato position={[-0.12, 0.14, 0.07]} scale={0.52} />
          <Tomato position={[0.12, 0.13, -0.05]} scale={0.48} />
        </>
      )}
      {item === 'soup' && (
        <>
          <Cylinder radii={[0.32, 0.32]} height={0.02} color="#df7440" position={[0, 0.115, 0]} />
          <Ball size={0.05} color="#6e954c" position={[0.04, 0.145, 0.08]} />
        </>
      )}
    </group>
  );
}

function Plant({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <Cylinder radii={[0.26, 0.19]} height={0.4} color="#efb591" position={[0, 0.2, 0]} />
      {[-0.6, 0.3, 1.3].map((a) => (
        <Ball
          key={a}
          size={0.23}
          scale={[0.65, 1.55, 0.7]}
          color={a > 0 ? '#5a9460' : '#3c7754'}
          position={[Math.sin(a) * 0.17, 0.57, Math.cos(a) * 0.1]}
          rotation={[0, 0, a * 0.5]}
        />
      ))}
    </group>
  );
}

const Room = memo(function Room() {
  return (
    <group>
      <Block size={[14.2, 0.4, 8.8]} position={[0, -0.26, 0]} radius={0.16} color="#94b7a0" />
      {Array.from({ length: 112 }, (_, i) => {
        const x = i % 14,
          z = Math.floor(i / 14);
        return (
          <mesh key={i} position={[x - 6.5, -0.035, z - 3.5]} receiveShadow>
            <boxGeometry args={[0.986, 0.06, 0.986]} />
            <meshStandardMaterial color={(x + z) % 2 ? '#dae4cf' : '#f0f0db'} roughness={1} />
          </mesh>
        );
      })}
      <Block size={[14, 2.45, 0.2]} position={[0, 1.2, -4.17]} color="#c4ddc4" />
      <Block size={[0.2, 1.35, 8.3]} position={[-7, 0.65, 0]} color="#c4ddc4" />
      <Block size={[14.15, 0.15, 0.3]} position={[0, 2.45, -4.17]} color={palette.green} />
      <Block size={[0.3, 0.14, 8.3]} position={[-7, 1.35, 0]} color={palette.green} />
      <Block size={[3.3, 1.6, 0.13]} position={[-3.85, 1.49, -4.02]} color={palette.white} />
      <Block size={[3.04, 1.36, 0.08]} position={[-3.85, 1.49, -3.93]} color="#b6dcdf" />
      <Block size={[0.09, 1.5, 0.12]} position={[-3.85, 1.5, -3.85]} color={palette.white} />
      <Block size={[3.3, 0.1, 0.15]} position={[-3.85, 1.5, -3.85]} color={palette.white} />
      <Block size={[3.55, 0.1, 0.55]} position={[-3.85, 0.7, -3.8]} color={palette.wood} />
      <Plant position={[-5.05, 0.76, -3.8]} scale={0.6} />
      <Block size={[3.1, 0.12, 0.55]} position={[0.25, 1.96, -3.82]} color={palette.wood} />
      {[0, 1, 2].map((i) => (
        <group key={i} position={[-0.75 + i * 0.62, 2.04, -3.8]}>
          <Cylinder
            height={0.35 + i * 0.06}
            radii={[0.17, 0.17]}
            position={[0, 0.18, 0]}
            color={['#eed4a5', '#bbceb2', '#edb799'][i]}
          />
          <Cylinder
            height={0.05}
            radii={[0.18, 0.18]}
            position={[0, 0.38 + i * 0.03, 0]}
            color={palette.green}
          />
        </group>
      ))}
      <Cylinder
        radii={[0.43, 0.43]}
        height={0.08}
        color={palette.green}
        position={[4.75, 1.65, -3.96]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <Cylinder
        radii={[0.36, 0.36]}
        height={0.09}
        color={palette.white}
        position={[4.75, 1.65, -3.9]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <Block
        size={[0.04, 0.25, 0.04]}
        position={[4.75, 1.74, -3.83]}
        color={palette.green}
        radius={0.01}
      />
      <Block
        size={[0.22, 0.04, 0.04]}
        position={[4.84, 1.65, -3.83]}
        color={palette.green}
        radius={0.01}
      />
      <Plant position={[-6.35, 0, 2.7]} scale={1.4} />
      <Plant position={[6.35, 0, -3.05]} scale={1.3} />
      <Block size={[2.65, 0.02, 0.7]} position={[0, 0.01, 3.73]} color="#d69172" radius={0.01} />
      {[-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9].map((x) => (
        <Block
          key={x}
          size={[0.025, 0.025, 0.63]}
          position={[x, 0.024, 3.73]}
          color="#f3c199"
          radius={0.005}
        />
      ))}
    </group>
  );
});

function Steam({ active }) {
  const group = useRef();
  const reducedMotion = useKitchen((s) => s.reducedMotion);
  useFrame(({ clock }) => {
    if (!group.current || !active || reducedMotion) return;
    group.current.children.forEach((puff, i) => {
      const t = (clock.elapsedTime * 0.55 + i / 3) % 1;
      puff.position.set(Math.sin(t * 4 + i) * 0.15, 1.58 + t * 0.7, 0);
      puff.scale.setScalar(0.6 + t * 1.3);
      puff.material.opacity = (1 - t) * 0.45;
    });
  });
  return (
    <group ref={group} visible={active}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 1.6 + i * 0.2, 0]}>
          <sphereGeometry args={[0.11, 10, 8]} />
          <meshBasicMaterial color="white" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function Station({ id }) {
  useKitchen((s) => s.revision);
  const g = useKitchen.getState().game,
    station = STATIONS[id],
    st = g.stations[id];
  const phase = useKitchen((s) => s.phase);
  const active = g.human.station === id;
  const working = st.state === 'chopping' || st.state === 'cooking';
  const progress = working ? 1 - (st.busyUntil - g.time) / (id === 'board' ? CHOP_MS : COOK_MS) : 1;
  const knife = useRef();
  useFrame(() => {
    if (knife.current)
      knife.current.rotation.z = st.state === 'chopping' ? Math.sin(g.time / 75) * 0.45 : -0.15;
  });
  const pick = (e) => {
    e.stopPropagation();
    goTo(id);
  };
  return (
    <group position={world(station.x + station.dx, station.y + station.dy)} onClick={pick}>
      <Block
        size={id === 'serve' ? [2.4, 0.93, 1.15] : [1.92, 0.93, 1.35]}
        position={[0, 0.48, 0]}
        color={id === 'serve' ? palette.coral : palette.mint}
      />
      <Block
        size={id === 'serve' ? [2.56, 0.14, 1.3] : [2.08, 0.14, 1.5]}
        position={[0, 1.015, 0]}
        color={palette.white}
      />
      <Block
        size={[0.62, 0.035, 0.06]}
        position={[0, 0.73, 0.7]}
        color={palette.green}
        radius={0.014}
      />
      <Block size={[0.03, 0.67, 0.02]} position={[0, 0.41, 0.682]} color="#66a48b" radius={0.005} />
      {id === 'crate' && (
        <>
          <Block size={[1.55, 0.16, 0.95]} position={[0, 1.13, 0]} color={palette.wood} />
          {[-0.65, 0.65].map((x) => (
            <Block key={x} size={[0.11, 0.35, 0.95]} position={[x, 1.28, 0]} color="#ba8859" />
          ))}
          {[-0.38, 0, 0.38].flatMap((x) =>
            [-0.2, 0.2].map((z) => (
              <Tomato key={`${x}-${z}`} position={[x, 1.38, z]} scale={0.85} />
            )),
          )}
        </>
      )}
      {id === 'board' && (
        <>
          <Block size={[1.5, 0.09, 0.93]} position={[0, 1.12, 0]} color="#d9b47c" />
          {st.state === 'chopping' && <Tomato position={[0, 1.36, 0]} />}
          {st.state === 'chopped' && (
            <group position={[0, 1.24, 0]}>
              <Food item="chopped" />
            </group>
          )}
          <group ref={knife} position={[0.45, 1.42, -0.14]}>
            <Block size={[0.07, 0.27, 0.56]} position={[0, 0, 0]} color="#d5e1e0" radius={0.025} />
            <Block size={[0.09, 0.12, 0.34]} position={[0, 0.06, 0.42]} color={palette.green} />
          </group>
        </>
      )}
      {id === 'pot' && (
        <>
          <Block size={[1.62, 0.08, 1.15]} position={[0, 1.12, 0]} color="#465d55" />
          <Cylinder
            radii={[0.51, 0.51]}
            height={0.04}
            color={working ? '#f8b75a' : '#82968d'}
            position={[0, 1.18, 0]}
          />
          <Cylinder
            radii={[0.49, 0.42]}
            height={0.43}
            color={palette.coral}
            position={[0, 1.42, 0]}
          />
          <Cylinder
            radii={[0.43, 0.43]}
            height={0.025}
            color={st.state === 'idle' ? '#694e45' : '#df7742'}
            position={[0, 1.642, 0]}
          />
          {[-0.59, 0.59].map((x) => (
            <Block key={x} size={[0.28, 0.11, 0.14]} position={[x, 1.5, 0]} color={palette.green} />
          ))}
          <Steam active={st.state === 'cooking' || st.state === 'ready'} />
        </>
      )}
      {id === 'plates' && (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <Cylinder
              key={i}
              radii={[0.46, 0.38]}
              height={0.055}
              position={[0, 1.15 + i * 0.065, 0]}
              color={palette.white}
            />
          ))}
          <Block size={[0.1, 0.1, 0.65]} position={[-0.7, 1.16, 0]} color={palette.wood} />
        </>
      )}
      {id === 'serve' && (
        <>
          <Block size={[1.25, 0.06, 0.73]} position={[-0.22, 1.12, 0]} color={palette.wood} />
          <Cylinder
            radii={[0.22, 0.25]}
            height={0.1}
            position={[0.85, 1.16, 0]}
            color={palette.green}
          />
          <Ball size={0.18} color={palette.yellow} position={[0.85, 1.25, 0]} scale={[1, 0.7, 1]} />
          <Ball size={0.04} color={palette.green} position={[0.85, 1.4, 0]} />
        </>
      )}
      <Html center position={[0, id === 'pot' ? 2.3 : 1.95, 0]} zIndexRange={[20, 0]}>
        <button
          className={`station-label ${active ? 'near' : ''}`}
          disabled={phase !== 'playing'}
          onClick={() => goTo(id)}
          aria-label={`${station.name}へ移動して作業`}
        >
          <span className={`station-dot ${id}`} />
          {station.name}
          {working && (
            <span className="station-meter">
              <i style={{ width: `${progress * 100}%` }} />
            </span>
          )}
          {(st.state === 'chopped' || st.state === 'ready') && <span className="ready-dot">✓</span>}
        </button>
      </Html>
      <mesh position={[-station.dx / 65, 0.012, -station.dy / 65]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.39, 0.45, 40]} />
        <meshBasicMaterial
          color={active ? '#ed826e' : '#7ca18b'}
          transparent
          opacity={active ? 0.95 : 0.35}
        />
      </mesh>
    </group>
  );
}

function Chef({ who }) {
  const root = useRef(),
    body = useRef(),
    leftArm = useRef(),
    rightArm = useRef();
  const previous = useRef(null);
  useKitchen((s) => s.revision);
  const reducedMotion = useKitchen((s) => s.reducedMotion);
  const human = who === 'human',
    color = human ? palette.coral : palette.yellow;
  const actor = useKitchen.getState().game[who];
  useFrame(() => {
    const { game: g, phase } = useKitchen.getState(),
      a = g[who];
    const pos = world(a.x, a.y);
    root.current.position.set(...pos);
    const prev = previous.current;
    const dx = prev ? a.x - prev[0] : 0,
      dy = prev ? a.y - prev[1] : 0;
    const moving = Math.hypot(dx, dy) > 0.03 && phase === 'playing';
    if (moving) body.current.rotation.y = Math.atan2(dx, dy);
    body.current.position.y =
      moving && !reducedMotion ? Math.abs(Math.sin(g.time / 85)) * 0.075 : 0;
    leftArm.current.rotation.x = moving && !reducedMotion ? Math.sin(g.time / 85) * 0.3 : -0.2;
    rightArm.current.rotation.x = -leftArm.current.rotation.x;
    previous.current = [a.x, a.y];
  });
  return (
    <group ref={root} position={world(actor.x, actor.y)}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <ringGeometry args={[0.34, 0.42, 32]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <group ref={body}>
        {[-0.15, 0.15].map((x) => (
          <Block
            key={x}
            size={[0.22, 0.17, 0.36]}
            position={[x, 0.13, 0.05]}
            color={palette.green}
            radius={0.07}
          />
        ))}
        <mesh position={[0, 0.58, 0]} castShadow>
          <capsuleGeometry args={[0.27, 0.33, 6, 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
        <Block size={[0.34, 0.38, 0.06]} position={[0, 0.56, 0.255]} color={palette.white} />
        <Block
          size={[0.19, 0.12, 0.035]}
          position={[0, 0.46, 0.3]}
          color={human ? '#f0b9a5' : '#e9cc88'}
          radius={0.02}
        />
        <group ref={leftArm} position={[-0.32, 0.73, 0]}>
          <Ball size={0.12} scale={[1, 1.6, 1]} color={color} position={[0, -0.06, 0]} />
          <Ball size={0.105} color="#eec7a2" position={[0, -0.23, 0.025]} />
        </group>
        <group ref={rightArm} position={[0.32, 0.73, 0]}>
          <Ball size={0.12} scale={[1, 1.6, 1]} color={color} position={[0, -0.06, 0]} />
          <Ball size={0.105} color="#eec7a2" position={[0, -0.23, 0.025]} />
        </group>
        <Ball size={0.285} color="#f2d0aa" position={[0, 1.04, 0]} />
        {[-0.105, 0.105].map((x) => (
          <Ball key={x} size={0.027} color="#34463a" position={[x, 1.055, 0.261]} />
        ))}
        <Ball size={0.045} color="#e5ae87" position={[0, 0.99, 0.28]} />
        <Cylinder radii={[0.275, 0.27]} height={0.2} color={palette.white} position={[0, 1.3, 0]} />
        {[-0.17, 0, 0.17].map((x) => (
          <Ball
            key={x}
            size={0.205}
            color={palette.white}
            position={[x, 1.47 + (x === 0 ? 0.075 : 0), 0]}
          />
        ))}
        {actor.carrying && (
          <group position={[0, 0.82, 0.56]} scale={0.86}>
            <Food item={actor.carrying} />
          </group>
        )}
      </group>
      <Html center position={[0, 2.08, 0]} zIndexRange={[15, 0]}>
        <span className={`chef-label ${human ? 'human' : 'ai'}`}>{human ? 'あなた' : '相棒'}</span>
      </Html>
    </group>
  );
}

function Confetti() {
  const group = useRef();
  const celebration = useKitchen((s) => s.celebration);
  const reducedMotion = useKitchen((s) => s.reducedMotion);
  const born = useRef(-10000);
  useEffect(() => {
    if (celebration) born.current = useKitchen.getState().game.time;
  }, [celebration]);
  useFrame(() => {
    const elapsed = (useKitchen.getState().game.time - born.current) / 1000;
    group.current.visible = !reducedMotion && elapsed >= 0 && elapsed < 1.2;
    if (!group.current.visible) return;
    group.current.children.forEach((piece, i) => {
      const angle = i * 2.399;
      piece.position.set(
        Math.sin(angle) * elapsed * 2.5,
        1.25 + elapsed * (3 + (i % 3)) - elapsed * elapsed * 4,
        Math.cos(angle) * elapsed * 1.6,
      );
      piece.rotation.set(elapsed * 4, angle + elapsed, elapsed * 3);
    });
  });
  return (
    <group ref={group} position={world(STATIONS.serve.x, STATIONS.serve.y)} visible={false}>
      {Array.from({ length: 22 }, (_, i) => (
        <mesh key={i}>
          <boxGeometry args={[0.08, 0.16, 0.035]} />
          <meshBasicMaterial color={['#ed826e', '#f4cd75', '#76b59b', '#faf8e9'][i % 4]} />
        </mesh>
      ))}
    </group>
  );
}

function Scene() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.position.set(10, 15, 18);
    camera.lookAt(0, 0.25, 0);
    camera.zoom = Math.min(size.width / 18.2, size.height / 13.5);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  useFrame((_, delta) => tick(delta));
  return (
    <>
      <color attach="background" args={['#dfeadd']} />
      <ambientLight intensity={1.35} />
      <directionalLight
        position={[-5, 11, 7]}
        intensity={2.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-normalBias={0.025}
      />
      <Room />
      {STATION_IDS.map((id) => (
        <Station key={id} id={id} />
      ))}
      <Chef who="human" />
      <Chef who="ai" />
      <Confetti />
    </>
  );
}

class GraphicsBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="graphics-error">
          3Dの描画を開始できませんでした。
          <br />
          ブラウザのグラフィックアクセラレーションを有効にして、再読み込みしてください。
          <button onClick={() => location.reload()}>再読み込み</button>
        </div>
      );
    return this.props.children;
  }
}

export default function Kitchen() {
  const [error, setError] = useState(false);
  const initialization = useRef(null);
  return (
    <GraphicsBoundary>
      {error ? (
        <div className="graphics-error">
          3Dを表示できません。グラフィックアクセラレーションを有効にして再読み込みしてください。
          <button onClick={() => location.reload()}>再読み込み</button>
        </div>
      ) : (
        <Canvas
          orthographic
          camera={{ position: [10, 15, 18], zoom: 45, near: 0.1, far: 100 }}
          dpr={[1, 1.75]}
          shadows={{ type: THREE.PCFShadowMap }}
          gl={(props) => {
            // R3F can configure again while init awaits the GPU; share one renderer.
            initialization.current ??= (async () => {
              try {
                const renderer = new THREE.WebGPURenderer({ ...props, antialias: true });
                await renderer.init();
                renderer.onDeviceLost = () => {
                  useKitchen.setState({ ready: false, phase: 'paused' });
                  setError(true);
                };
                return renderer;
              } catch (cause) {
                setError(true);
                throw cause;
              }
            })();
            return initialization.current;
          }}
          onCreated={({ gl }) =>
            useKitchen.setState({
              backend: gl.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2',
              ready: true,
            })
          }
          fallback={
            <div className="graphics-error">
              このブラウザでは3Dを表示できません。最新のChromeで開いてください。
            </div>
          }
        >
          <Scene />
        </Canvas>
      )}
    </GraphicsBoundary>
  );
}
