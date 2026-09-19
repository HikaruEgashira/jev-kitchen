import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useThree } from '@react-three/fiber';
import { ScreenSpace } from '@react-three/drei/core/ScreenSpace';
import { ScreenSizer } from '@react-three/drei/core/ScreenSizer';
import { Text3D } from '@react-three/drei/core/Text3D';
import { Center } from '@react-three/drei/core/Center';
import { Lettering, Plaque, INK, PAPER, WOOD } from './Surface.jsx';
import { screen, preparation, purchase, compactControls } from './ui.js';
import { ProductPreview } from './Food.jsx';
import {
  useKitchen,
  startShift,
  nextShift,
  retryShift,
  togglePause,
  setMenuOpen,
  setCameraMode,
  setMovementMode,
  rollbackToPreparation,
  rollbackToPreviousStage,
  toggleSound,
  togglePauseWhenAway,
  humanInteract,
  humanDash,
  clearHands,
  goTo,
  TUTORIAL_STEPS,
} from './game.js';
import { STATIONS, activeStationIds } from './model.js';

// R3F and React DOM have separate reconcilers; native editing needs its own DOM root.
function DomBridge({ children }) {
  const domRoot = useRef();
  useLayoutEffect(() => {
    const node = document.createElement('div');
    document.getElementById('ui-access').append(node);
    const mounted = createRoot(node);
    domRoot.current = mounted;
    return () => {
      node.remove();
      domRoot.current = null;
      queueMicrotask(() => mounted.unmount());
    };
  }, []);
  useLayoutEffect(() => {
    domRoot.current?.render(children);
  });
  return null;
}

function Semantics({ ui, semantic, page, ready, children }) {
  useLayoutEffect(() => {
    if (!ui.modal) return;
    const first =
      semantic.current?.querySelector('[data-ui="primary"]:not(:disabled)') ??
      semantic.current?.querySelector('button:not(:disabled)');
    first?.focus({ preventScroll: true });
  }, [ui.modal, page, ready, semantic]);
  return (
    <div
      ref={semantic}
      className="semantics"
      role={ui.modal ? 'dialog' : 'region'}
      aria-modal={ui.modal ? true : undefined}
      aria-label={ui.title}
    >
      {children}
    </div>
  );
}

const Tile = memo(function Tile({ item, active, activate, hover }) {
  const control = ['button', 'number'].includes(item.kind);
  return (
    <group position={[item.x + item.w / 2, -item.y - item.h / 2, 0]}>
      {item.kind === 'title3d' ? (
        <Center position={[0, 0, 18]} rotation={[-0.08, -0.12, -0.025]}>
          <Text3D
            font="/fonts/title.typeface.json"
            size={item.size}
            height={item.size * 0.22}
            bevelEnabled
            bevelThickness={1.2}
            bevelSize={0.7}
            bevelSegments={3}
            renderOrder={item.order}
            raycast={() => null}
          >
            SIDEKICK
            <meshStandardMaterial
              attach="material-0"
              color={INK}
              roughness={0.5}
              transparent
              depthTest={false}
              depthWrite={false}
            />
            <meshStandardMaterial
              attach="material-1"
              color="#d69b4b"
              roughness={0.65}
              transparent
              depthTest={false}
              depthWrite={false}
            />
          </Text3D>
        </Center>
      ) : item.kind === 'food' ? (
        <group position={[0, 0, 24]}>
          <ProductPreview item={item.recipe} size={item.w * 0.9} order={item.order} />
        </group>
      ) : item.kind === 'veil' ? (
        <mesh
          renderOrder={item.order}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
        >
          <planeGeometry args={[item.w, item.h]} />
          <meshBasicMaterial
            color="#19382e"
            transparent
            opacity={0.35}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ) : item.kind === 'text' ? (
        <Lettering
          text={item.text}
          width={item.w}
          height={item.h}
          size={item.size ?? 16}
          color={item.color}
          order={item.order}
        />
      ) : (
        <Plaque
          width={item.w}
          height={item.h}
          order={item.order}
          color={
            item.disabled ? '#d2d8c7' : active || item.pressed ? '#f4cd75' : (item.color ?? PAPER)
          }
          edge={active ? INK : WOOD}
          onPointerOver={(e) => {
            e.stopPropagation();
            if (control && !item.inert && !item.disabled) hover(item.id);
          }}
          onPointerOut={() => hover(null)}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (control && !item.inert && !item.disabled) activate(item.id);
          }}
        >
          {control && (
            <Lettering
              text={item.text}
              width={item.w - 8}
              height={item.h - 4}
              size={item.size ?? 16}
              color={item.disabled ? '#63705c' : active || item.pressed ? INK : (item.ink ?? INK)}
              order={item.order + 2}
            />
          )}
        </Plaque>
      )}
    </group>
  );
});

function Screen() {
  const s = useKitchen();
  const { size, gl } = useThree();
  const [localView, setView] = useState(() => preparation(s.game, s.reviewing));
  const view = s.benchmark && s.benchPreparation ? s.benchPreparation : localView;
  const [focus, setFocus] = useState(null);
  const [hover, setHover] = useState(null);
  const controls = useRef(new Map());
  const semantic = useRef();
  const ui = screen(s, view, size.width, size.height);
  const latest = useRef();
  const patch = (values) => {
    if (s.benchmark && s.benchPreparation)
      useKitchen.setState({ benchPreparation: { ...view, error: '', ...values } });
    else setView((v) => ({ ...v, error: '', ...values }));
  };
  const dispatch = (item, value = item.value) => {
    if (item.disabled || item.inert) return;
    const g = useKitchen.getState().game;
    switch (item.action) {
      case 'start':
        startShift();
        break;
      case 'retry':
        retryShift();
        break;
      case 'review':
        rollbackToPreparation();
        break;
      case 'previous':
        rollbackToPreviousStage();
        break;
      case 'pause':
        togglePause();
        break;
      case 'menu':
        setMenuOpen(true);
        break;
      case 'close-menu':
        setMenuOpen(false);
        break;
      case 'sound':
        toggleSound();
        break;
      case 'away-pause':
        togglePauseWhenAway();
        break;
      case 'camera':
        setCameraMode(value);
        break;
      case 'movement':
        setMovementMode(value);
        break;
      case 'menu-page':
        patch({ menuPage: value });
        break;
      case 'interact':
        humanInteract();
        break;
      case 'station':
        goTo(value);
        break;
      case 'dash':
        humanDash();
        break;
      case 'clear':
        clearHands();
        break;
      case 'duty': {
        const current = [...new Set(Array.isArray(view.duty) ? view.duty : [])];
        if (current.includes(value)) {
          patch({ duty: current.filter((id) => id !== value) });
        } else {
          const slots = Number(item.slots ?? item.max ?? 0) || Number(purchase(g, view).slots ?? 1);
          if (current.length < slots) patch({ duty: [...current, value] });
        }
        break;
      }
      case 'page':
        patch({ page: value });
        break;
      case 'applicant-index':
        patch({
          applicantIndex: (view.applicantIndex + value + s.applicants.length) % s.applicants.length,
        });
        break;
      case 'hire':
        patch({ selected: value });
        break;
      case 'skip':
        patch({ selected: null });
        break;
      case 'quantity':
        patch({ quantity: Math.min(99, Math.max(0, (Number(view.quantity) || 0) + value)) });
        break;
      case 'quantity-input':
        patch({ quantity: value });
        break;
      case 'next': {
        const bill = purchase(g, view);
        if (!bill.error && !nextShift(view.selected, bill.quantity, bill.duty))
          patch({ error: '準備内容を確認してください。' });
        break;
      }
    }
  };
  latest.current = { ui, dispatch };
  const activate = (id) => {
    const element = controls.current.get(id);
    element?.focus({ preventScroll: true });
    if (element?.tagName === 'INPUT') element.select();
    else element?.click();
  };
  useEffect(() => {
    gl.domElement.style.cursor = hover ? 'pointer' : '';
    return () => {
      gl.domElement.style.cursor = '';
    };
  }, [gl, hover]);
  useEffect(() => {
    const keydown = (e) => {
      if (e.key === 'Escape' && e.target?.tagName === 'INPUT') {
        e.preventDefault();
        e.stopPropagation();
        e.target.blur();
        return;
      }
      if (e.key !== 'Tab' || !latest.current.ui.modal) return;
      const buttons = [
        ...(semantic.current?.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), a[href]',
        ) ?? []),
      ];
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement);
      const next = (index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      e.preventDefault();
      buttons[next].focus({ preventScroll: true });
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, []);
  const stations =
    !compactControls(size.width, size.height) && s.phase === 'playing' && !ui.modal
      ? activeStationIds(s.game)
      : [];
  return (
    <>
      <ScreenSpace depth={10}>
        <ScreenSizer>
          <group position={[-size.width / 2, size.height / 2, 0]}>
            {ui.items.map((item) => (
              <Tile
                key={item.id}
                item={item}
                active={focus === item.id || hover === item.id}
                activate={activate}
                hover={setHover}
              />
            ))}
          </group>
        </ScreenSizer>
      </ScreenSpace>
      <DomBridge>
        <Semantics ui={ui} semantic={semantic} page={view.menuPage} ready={s.ready}>
          {ui.items
            .filter((item) => !item.inert)
            .map((item) => {
              const common = {
                ref: (el) => {
                  if (el) controls.current.set(item.id, el);
                  else controls.current.delete(item.id);
                },
                'data-ui': item.id,
                'aria-label': item.label ?? item.text,
                onFocus: () => setFocus(item.id),
                onBlur: () => setFocus(null),
              };
              if (item.kind === 'number')
                return (
                  <input
                    key={item.id}
                    {...common}
                    className="native-field"
                    style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="99"
                    step="1"
                    value={view.quantity}
                    onChange={(e) => dispatch(item, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                  />
                );
              if (item.action === 'link')
                return (
                  <a
                    key={item.id}
                    {...common}
                    className="sr-only"
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.text}
                  </a>
                );
              if (item.kind === 'button')
                return (
                  <button
                    key={item.id}
                    {...common}
                    className="sr-only"
                    type="button"
                    disabled={item.disabled}
                    aria-pressed={item.pressed}
                    onClick={() => dispatch(item)}
                  >
                    {item.text}
                  </button>
                );
              if (item.kind === 'text' || item.kind === 'title3d')
                return (
                  <p key={item.id} className="sr-only">
                    {item.text}
                  </p>
                );
              return null;
            })}
          {stations.map((id) => (
            <button
              key={id}
              className="sr-only"
              disabled={s.tutorial !== null && TUTORIAL_STEPS[s.tutorial]?.station !== id}
              onFocus={() => useKitchen.setState({ focusedStation: id })}
              onBlur={() => useKitchen.setState({ focusedStation: null })}
              onClick={() => goTo(id)}
            >
              {STATIONS[id].name}へ移動して作業
            </button>
          ))}
          <p className="sr-only" role="status" aria-live="polite">
            {ui.status}
          </p>
        </Semantics>
      </DomBridge>
    </>
  );
}

export default function SceneUI() {
  const level = useKitchen((s) => s.game.level);
  const finished = useKitchen((s) => s.phase === 'finished');
  const reviewing = useKitchen((s) => s.reviewing);
  return <Screen key={`${level}-${finished}-${reviewing}`} />;
}
