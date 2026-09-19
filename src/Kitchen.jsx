import { Children, Component, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, events, useFrame, useThree } from '@react-three/fiber';
import { WorldLabel, Typography, prepareFont, resetFont } from './Surface.jsx';
import SceneUI from './SceneUI.jsx';
import { Block, Ball, Cylinder, Tomato, Food } from './Food.jsx';
import * as THREE from 'three/webgpu';
import { graphicsLost, TUTORIAL_STEPS, useKitchen, goTo, tick } from './game.js';
import {
  STATIONS,
  BOOST_MIN,
  BOOST_MAX,
  POT_BURN_MS,
  GRILL_BURN_MS,
  activeStationIds,
  kitchenBounds,
  levelConfig,
} from './model.js';
import { ENTRANCE_DURATION, entranceHeight } from './entrance.js';

const world = (x, y, height = 0) => [(x - 450) / 65, height, (y - 270) / 65];
const FLOOR_ROWS = 8;
const FLOOR_COLUMNS = Object.freeze({ 1: 14, 2: 16, 3: 20 });
const FLOOR_MAX_TILES = FLOOR_ROWS * FLOOR_COLUMNS[3];
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const palette = {
  mint: '#76b59b',
  green: '#245e50',
  coral: '#ed826e',
  yellow: '#f4cd75',
  white: '#fff9e8',
  wood: '#c89969',
  steel: '#a5bbb3',
};

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

function Floor({ level }) {
  const tiles = useRef();
  const columns = FLOOR_COLUMNS[level] ?? FLOOR_COLUMNS[1];
  useLayoutEffect(() => {
    const mesh = tiles.current;
    if (!mesh) return;
    const tile = new THREE.Object3D();
    const color = new THREE.Color();
    const tileCount = columns * FLOOR_ROWS;
    mesh.count = tileCount;
    for (let i = 0; i < tileCount; i++) {
      const x = i % columns;
      const z = Math.floor(i / columns);
      tile.position.set(x - 6.5, -0.035, z - 3.5);
      tile.scale.setScalar(1);
      tile.updateMatrix();
      mesh.setMatrixAt(i, tile.matrix);
      color.set((x + z) % 2 ? '#dae4cf' : '#f0f0db');
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [columns]);
  return (
    <instancedMesh ref={tiles} args={[null, null, FLOOR_MAX_TILES]} receiveShadow>
      <boxGeometry args={[0.986, 0.06, 0.986]} />
      <meshStandardMaterial vertexColors roughness={1} />
    </instancedMesh>
  );
}

function Entrance({ timeline, delay = 0, children }) {
  const group = useRef();
  useFrame(() => {
    group.current.visible = timeline.current >= delay;
    group.current.position.y = entranceHeight(timeline.current, delay);
  });
  return (
    <group
      ref={group}
      visible={timeline.current >= delay}
      position={[0, entranceHeight(timeline.current, delay), 0]}
    >
      {children}
    </group>
  );
}

const Room = memo(function Room({ level, timeline }) {
  const right = level === 1 ? 7.1 : level === 2 ? 9.1 : 13.1;
  const width = right + 7.1;
  const center = (right - 7.1) / 2;
  const parts = [
    <group key="floor">
      <Block size={[width, 0.4, 8.8]} position={[center, -0.26, 0]} radius={0.16} color="#94b7a0" />
      <Floor level={level} />
    </group>,
    <group key="back-wall">
      <Block size={[width - 0.2, 2.45, 0.2]} position={[center, 1.2, -4.17]} color="#c4ddc4" />
      <Block
        size={[width - 0.05, 0.15, 0.3]}
        position={[center, 2.45, -4.17]}
        color={palette.green}
      />
    </group>,
    <group key="left-wall">
      <Block size={[0.2, 1.35, 8.3]} position={[-7, 0.65, 0]} color="#c4ddc4" />
      <Block size={[0.3, 0.14, 8.3]} position={[-7, 1.35, 0]} color={palette.green} />
    </group>,
    <group key="right-wall">
      <Block size={[0.2, 1.35, 8.3]} position={[right, 0.65, 0]} color="#c4ddc4" />
      <Block size={[0.3, 0.14, 8.3]} position={[right, 1.35, 0]} color={palette.green} />
    </group>,
    <group key="window">
      <Block size={[3.3, 1.6, 0.13]} position={[-3.85, 1.49, -4.02]} color={palette.white} />
      <Block size={[3.04, 1.36, 0.08]} position={[-3.85, 1.49, -3.93]} color="#b6dcdf" />
      <Block size={[0.09, 1.5, 0.12]} position={[-3.85, 1.5, -3.85]} color={palette.white} />
      <Block size={[3.3, 0.1, 0.15]} position={[-3.85, 1.5, -3.85]} color={palette.white} />
      <Block size={[3.55, 0.1, 0.55]} position={[-3.85, 0.7, -3.8]} color={palette.wood} />
      <Plant position={[-5.05, 0.76, -3.8]} scale={0.6} />
    </group>,
    <group key="shelf">
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
    </group>,
    <group key="clock">
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
    </group>,
    <Plant key="left-plant" position={[-6.35, 0, 2.7]} scale={1.4} />,
    <Plant key="right-plant" position={[6.35, 0, -3.05]} scale={1.3} />,
    <group key="rug">
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
    </group>,
  ];
  return Children.map(parts, (part, index) => (
    <Entrance timeline={timeline} delay={index * 0.085}>
      {part}
    </Entrance>
  ));
});

function Steam({ active }) {
  const group = useRef();
  const reducedMotion = useKitchen((s) => s.reducedMotion);
  const phase = useKitchen((s) => s.phase);
  useFrame(({ clock }) => {
    if (!group.current || !active || reducedMotion || phase !== 'playing') return;
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
  const tutorial = useKitchen((s) => s.tutorial);
  const graphicsReady = useKitchen((s) => s.ready);
  const reducedMotion = useKitchen((s) => s.reducedMotion);
  const focused = useKitchen((s) => s.focusedStation === id);
  const active = g.human.station === id;
  const tutorialActive =
    phase === 'playing' &&
    Number.isInteger(tutorial) &&
    tutorial >= 0 &&
    tutorial < TUTORIAL_STEPS.length;
  const tutorialStep = tutorialActive ? TUTORIAL_STEPS[tutorial] : null;
  const tutorialTarget = tutorialStep?.station === id;
  const tutorialMuted = tutorialActive && !tutorialTarget;
  const tutorialComplete = tutorial === TUTORIAL_STEPS.length;
  const heating = st.state === 'cooking';
  const ready = st.state === 'ready';
  const burnt = st.state === 'burnt';
  const working = st.state === 'chopping' || heating;
  const progress = working ? clamp01(1 - (st.busyUntil - g.time) / st.duration) : 1;
  const burnDeadline = st.burnAt;
  const burnWindow = Number.isFinite(burnDeadline)
    ? clamp01((burnDeadline - g.time) / (id === 'grill' ? GRILL_BURN_MS : POT_BURN_MS))
    : null;
  const danger = burnt || (ready && burnWindow !== null && burnWindow < 0.35);
  const stockFinite = Number.isFinite(g.stock);
  const stockCount = stockFinite ? Math.max(0, Math.floor(g.stock)) : null;
  const crateTomatoCount = stockCount === null ? 6 : Math.min(6, stockCount);
  const boostWindow =
    working &&
    (id === 'board' || id === 'pot' || id === 'grill') &&
    !st.boosted &&
    !g.human.carrying &&
    progress >= BOOST_MIN &&
    progress <= BOOST_MAX;
  const ringColor = tutorialTarget
    ? '#e07c58'
    : tutorialActive
      ? '#95a89b'
      : danger
        ? '#c7594b'
        : active
          ? '#ed826e'
          : ready
            ? '#e2ae45'
            : '#7ca18b';
  const ringOpacity = tutorialTarget
    ? 0.98
    : tutorialActive
      ? 0.12
      : active
        ? 0.95
        : ready
          ? 0.72
          : 0.35;
  const knife = useRef();
  useFrame(() => {
    if (knife.current)
      knife.current.rotation.z =
        st.state === 'chopping' && !reducedMotion ? Math.sin(g.time / 75) * 0.45 : -0.15;
  });
  const pick = (e) => {
    e.stopPropagation();
    if (tutorialMuted || tutorialComplete) return;
    goTo(id);
  };
  return (
    <group position={world(station.x + station.dx, station.y + station.dy)} onClick={pick}>
      <Block
        size={id === 'serve' ? [2.4, 0.93, 1.15] : [1.92, 0.93, 1.35]}
        position={[0, 0.48, 0]}
        color={id === 'serve' ? palette.coral : id === 'grill' ? '#52665e' : palette.mint}
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
          {[-0.38, 0, 0.38]
            .flatMap((x) => [-0.2, 0.2].map((z) => [x, z]))
            .slice(0, crateTomatoCount)
            .map(([x, z]) => (
              <Tomato key={`${x}-${z}`} position={[x, 1.38, z]} scale={0.85} />
            ))}
          <WorldLabel
            position={[0, 2.6, 0]}
            text={stockCount === null ? '∞' : `残り ${stockCount}`}
            visible={graphicsReady && phase !== 'ready'}
          />
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
            color={danger ? '#8b4338' : st.state === 'idle' ? '#694e45' : '#df7742'}
            position={[0, 1.642, 0]}
          />
          {[-0.59, 0.59].map((x) => (
            <Block key={x} size={[0.28, 0.11, 0.14]} position={[x, 1.5, 0]} color={palette.green} />
          ))}
          <Steam active={heating || ready} />
        </>
      )}
      {id === 'grill' && (
        <>
          <Block size={[1.62, 0.08, 1.15]} position={[0, 1.12, 0]} color="#465d55" />
          {[-0.42, -0.14, 0.14, 0.42].map((x) => (
            <Block
              key={x}
              size={[0.08, 0.08, 0.92]}
              position={[x, 1.2, 0]}
              color="#8b9d93"
              radius={0.02}
            />
          ))}
          <Block
            size={[1.15, 0.035, 0.74]}
            position={[0, 1.27, 0]}
            color={danger ? '#8b4338' : heating ? '#e98b4e' : '#566f66'}
            radius={0.015}
          />
          {(heating || ready || burnt) && (
            <group position={[0, 1.34, 0]}>
              <Food item={ready || burnt ? 'roast' : 'chopped'} burnt={burnt} />
            </group>
          )}
          <Steam active={heating || ready} />
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
      <WorldLabel
        position={[0, id === 'pot' || id === 'grill' ? 2.3 : 1.95, 0]}
        visible={graphicsReady && phase !== 'ready'}
        text={
          tutorialTarget
            ? tutorialStep.label
            : `${station.name}${ready || st.state === 'chopped' ? ' 完成' : ''}${danger ? ' 焦げ注意' : ''}`
        }
        width={tutorialTarget ? 210 : danger ? 144 : 100}
        color={
          focused
            ? '#f4cd75'
            : tutorialTarget
              ? '#f4cd75'
              : tutorialMuted
                ? '#c4ddc4'
                : boostWindow
                  ? '#f4cd75'
                  : palette.white
        }
        progress={working ? progress : ready ? burnWindow : null}
        danger={danger}
        onClick={pick}
      />
      <mesh position={[-station.dx / 65, 0.012, -station.dy / 65]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[tutorialTarget ? 0.42 : 0.39, tutorialTarget ? 0.5 : 0.45, 40]} />
        <meshBasicMaterial color={ringColor} transparent opacity={ringOpacity} />
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
  const phase = useKitchen((s) => s.phase);
  const graphicsReady = useKitchen((s) => s.ready);
  const human = who === 'human',
    color = human ? palette.coral : palette.yellow;
  const actor = useKitchen.getState().game[who];
  useFrame(() => {
    const { game: g, phase } = useKitchen.getState(),
      a = g[who];
    const station = a.station ? g.stations[a.station] : null;
    const carrying = Boolean(a.carrying);
    const working = !carrying && station?.state === 'chopping' && station.by === who;
    const pos = world(a.x, a.y);
    root.current.position.set(...pos);
    const prev = previous.current;
    const dx = prev ? a.x - prev[0] : 0,
      dy = prev ? a.y - prev[1] : 0;
    const moving = Math.hypot(dx, dy) > 0.03 && phase === 'playing';
    if (moving) body.current.rotation.y = Math.atan2(dx, dy);
    body.current.position.y =
      moving && !reducedMotion ? Math.abs(Math.sin(g.time / 85)) * (carrying ? 0.035 : 0.075) : 0;
    const walkSwing = moving && !reducedMotion ? Math.sin(g.time / 85) * 0.3 : -0.2;
    const workSwing = working && !reducedMotion ? Math.sin(g.time / 80) * 0.5 : 0;
    const carrySway = carrying && !reducedMotion ? Math.sin(g.time / 160) * 0.06 : 0;
    leftArm.current.rotation.x = carrying
      ? 0.65 + carrySway
      : working
        ? 0.35 + workSwing
        : walkSwing;
    rightArm.current.rotation.x = carrying
      ? 0.65 - carrySway
      : working
        ? 0.35 - workSwing
        : -walkSwing;
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
      <WorldLabel
        position={[0, 2.08, 0]}
        visible={graphicsReady && phase !== 'ready'}
        text={`${human ? 'あなた' : '相棒'}`}
        width={actor.carrying ? 112 : 84}
        color={human ? '#f7c4af' : palette.yellow}
      />
    </group>
  );
}

function Confetti() {
  const group = useRef();
  const celebration = useKitchen((s) => s.celebration);
  const phase = useKitchen((s) => s.phase);
  const reducedMotion = useKitchen((s) => s.reducedMotion);
  const previousCelebration = useRef(celebration);
  const previousTime = useRef(useKitchen.getState().game.time);
  const born = useRef(-Infinity);
  useEffect(() => {
    if (celebration === 0) born.current = -Infinity;
    else if (celebration > previousCelebration.current)
      born.current = useKitchen.getState().game.time;
    previousCelebration.current = celebration;
  }, [celebration]);
  useFrame(() => {
    if (!group.current) return;
    const time = useKitchen.getState().game.time;
    if (time < previousTime.current) {
      born.current = -Infinity;
      previousCelebration.current = celebration;
    }
    previousTime.current = time;
    const elapsed = (time - born.current) / 1000;
    group.current.visible = phase === 'playing' && !reducedMotion && elapsed >= 0 && elapsed < 1.2;
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
  useKitchen((s) => s.revision);
  const tutorial = useKitchen((s) => s.tutorial);
  const reducedMotion = useKitchen((s) => s.reducedMotion);
  const game = useKitchen.getState().game;
  const level = levelConfig(game.level).kitchenTier;
  const stationIds = activeStationIds(game);
  const timeline = useRef(useKitchen.getState().phase === 'ready' ? 0 : ENTRANCE_DURATION);
  const cameraTarget = useRef(new THREE.Vector3(0, 0.25, 0));
  useEffect(() => {
    camera.position.set(10, 15, 18);
    camera.lookAt(cameraTarget.current);
    camera.zoom = Math.min(size.width / 18.2, size.height / 13.5);
    camera.updateProjectionMatrix();
  }, [camera]);
  useFrame((_, delta) => {
    timeline.current = reducedMotion
      ? ENTRANCE_DURATION
      : Math.min(ENTRANCE_DURATION, timeline.current + delta);
    if (timeline.current === ENTRANCE_DURATION && !useKitchen.getState().ready)
      useKitchen.setState({ ready: true });
    const bounds = kitchenBounds(game);
    const center = world((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0.25);
    const fitWidth = (bounds.maxX - bounds.minX) / 65 + 7.6;
    const fitHeight = (bounds.maxY - bounds.minY) / 65 + 10;
    const fitZoom = Math.min(size.width / fitWidth, size.height / fitHeight);
    const approach = (current, goal) =>
      reducedMotion ? goal : THREE.MathUtils.damp(current, goal, 6, delta);
    cameraTarget.current.x = approach(cameraTarget.current.x, center[0]);
    cameraTarget.current.y = approach(cameraTarget.current.y, center[1]);
    cameraTarget.current.z = approach(cameraTarget.current.z, center[2]);
    camera.position.x = approach(camera.position.x, cameraTarget.current.x + 10);
    camera.position.y = approach(camera.position.y, cameraTarget.current.y + 14.75);
    camera.position.z = approach(camera.position.z, cameraTarget.current.z + 18);
    camera.lookAt(cameraTarget.current);
    camera.zoom = approach(camera.zoom, fitZoom);
    camera.updateProjectionMatrix();
    tick(delta);
  }, -1);
  return (
    <>
      <color attach="background" args={['#dfeadd']} />
      <ambientLight intensity={1.35} />
      <directionalLight
        position={[-5, 11, 7]}
        intensity={2.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={level === 3 ? 16 : 12}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-normalBias={0.025}
      />
      <Room level={level} timeline={timeline} />
      {stationIds.map((id, index) => (
        <Entrance key={id} timeline={timeline} delay={0.7 + index * 0.1}>
          <Station id={id} />
        </Entrance>
      ))}
      <Entrance timeline={timeline} delay={1.25}>
        <Chef who="human" />
      </Entrance>
      {tutorial === null && (
        <Entrance timeline={timeline} delay={1.4}>
          <Chef who="ai" />
        </Entrance>
      )}
      <Confetti />
    </>
  );
}

class GraphicsBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    const { ready, phase } = useKitchen.getState();
    if (ready || phase === 'playing') graphicsLost();
  }
  render() {
    if (this.state.failed)
      return (
        <div className="graphics-error">
          3Dの描画を開始できませんでした。
          <br />
          WebGPU対応ブラウザでグラフィックアクセラレーションを有効にして、再接続してください。
          <button onClick={this.props.onRetry}>3Dを再接続</button>
          <button onClick={() => location.reload()}>再読み込み</button>
        </div>
      );
    return this.props.children;
  }
}

export default function Kitchen() {
  const [error, setError] = useState(false);
  const [graphicsKey, setGraphicsKey] = useState(0);
  const initialization = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const rendererDisposeRef = useRef(null);
  const retryInFlight = useRef(false);
  const graphicsGeneration = useRef(0);
  const lifecycleGeneration = useRef(0);
  useEffect(() => {
    const lifecycle = ++lifecycleGeneration.current;
    return () => {
      queueMicrotask(() => {
        if (lifecycle !== lifecycleGeneration.current) return;
        graphicsGeneration.current += 1;
        initialization.current = null;
        const disposeRenderer = rendererDisposeRef.current;
        rendererDisposeRef.current = null;
        rendererRef.current = null;
        void disposeRenderer?.();
      });
    };
  }, []);
  const retryGraphics = async () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    const generation = ++graphicsGeneration.current;
    try {
      const disposeRenderer = rendererDisposeRef.current;
      rendererDisposeRef.current = null;
      await disposeRenderer?.();
      if (generation !== graphicsGeneration.current) return;
      rendererRef.current = null;
      initialization.current = null;
      resetFont();
      setError(false);
      setGraphicsKey((key) => key + 1);
    } finally {
      retryInFlight.current = false;
    }
  };
  return (
    <GraphicsBoundary key={graphicsKey} onRetry={retryGraphics}>
      {error ? (
        <div className="graphics-error">
          WebGPUを利用できません。対応ブラウザでグラフィックアクセラレーションを有効にして再接続してください。
          <button onClick={retryGraphics}>3Dを再接続</button>
          <button onClick={() => location.reload()}>再読み込み</button>
        </div>
      ) : (
        <Canvas
          orthographic
          events={(state) => ({
            ...events(state),
            filter: (hits) =>
              hits.sort(
                (a, b) => b.object.renderOrder - a.object.renderOrder || a.distance - b.distance,
              ),
          })}
          camera={{ position: [10, 15, 18], zoom: 45, near: 0.1, far: 100 }}
          dpr={[1, 1.5]}
          shadows={{ type: THREE.PCFShadowMap }}
          gl={(props) => {
            // A remounted Canvas (including HMR) must not reuse a detached GPU target.
            if (canvasRef.current !== props.canvas) {
              canvasRef.current = props.canvas;
              graphicsGeneration.current += 1;
              void rendererDisposeRef.current?.();
              rendererDisposeRef.current = null;
              rendererRef.current = null;
              initialization.current = null;
            }
            const generation = graphicsGeneration.current;
            // R3F can configure again while init awaits the GPU; share one renderer.
            initialization.current ??= (async () => {
              let renderer;
              let disposal;
              const disposeRenderer = () => {
                if (!renderer) return Promise.resolve();
                disposal ??= Promise.resolve()
                  .then(() =>
                    renderer.hasInitialized() ? renderer.dispose() : renderer.backend.dispose(),
                  )
                  .catch(() => {
                    /* A failed GPU is already unrecoverable; continue to fallback UI. */
                  });
                return disposal;
              };
              rendererDisposeRef.current = disposeRenderer;
              try {
                renderer = new THREE.WebGPURenderer({
                  ...props,
                  antialias: true,
                });
                // ponytail: Three r186 has no public WebGPU-only switch; recheck on upgrade.
                renderer._getFallback = null;
                rendererRef.current = renderer;
                let deviceLost = false;
                const defaultOnDeviceLost = renderer.onDeviceLost.bind(renderer);
                renderer.onDeviceLost = (info) => {
                  deviceLost = true;
                  defaultOnDeviceLost(info);
                  if (generation !== graphicsGeneration.current) return;
                  graphicsLost();
                  setError(true);
                  void disposeRenderer();
                };
                await renderer.init();
                await prepareFont();
                const device = renderer.backend?.device;
                if (device?.lost) {
                  void device.lost
                    .then((info) => {
                      if (
                        info?.reason !== 'destroyed' ||
                        deviceLost ||
                        generation !== graphicsGeneration.current
                      )
                        return;
                      renderer.onDeviceLost({
                        api: 'WebGPU',
                        message: info.message || 'Unknown reason',
                        reason: info.reason,
                        originalEvent: info,
                      });
                    })
                    .catch(() => {});
                }
                if (deviceLost || generation !== graphicsGeneration.current) {
                  await disposeRenderer();
                  throw new Error('stale graphics initialization');
                }
                return renderer;
              } catch {
                const current = generation === graphicsGeneration.current;
                if (current) {
                  graphicsLost();
                  setError(true);
                }
                await disposeRenderer();
                if (rendererRef.current === renderer) rendererRef.current = null;
                if (rendererDisposeRef.current === disposeRenderer)
                  rendererDisposeRef.current = null;
                // R3F's Canvas configure has no rejection boundary. Keep the
                // retired configure suspended after surfacing the retry UI so it
                // cannot construct a second renderer on a lost or stale canvas.
                await new Promise(() => {});
              }
            })();
            return initialization.current;
          }}
          onCreated={({ gl }) =>
            gl === rendererRef.current &&
            useKitchen.setState({
              backend: 'WebGPU',
              ready: false,
            })
          }
          fallback={
            <div className="graphics-error">
              このブラウザでは3Dを表示できません。WebGPU対応ブラウザで開いてください。
            </div>
          }
        >
          <Typography>
            <Scene />
            <SceneUI />
          </Typography>
        </Canvas>
      )}
    </GraphicsBoundary>
  );
}
