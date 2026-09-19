import { MathUtils } from 'three/webgpu';
import type { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { kitchenBounds, kitchenExpansion, levelConfig, roomShell } from './model.ts';
import type { CameraMode, Framing, GameState, Phase } from './types.ts';

// Fraction of the screen height the kitchen render is lowered by.
export const SCENE_DROP = 0.06;

export function cameraFraming(
  game: GameState,
  phase: Phase,
  mode: CameraMode,
  width: number,
  height: number,
  entranceComplete = true,
): Framing {
  const bounds = kitchenBounds(game);
  const follow =
    entranceComplete &&
    ['ready', 'playing', 'paused'].includes(phase) &&
    (mode === 'follow' || (mode === 'auto' && width < height));
  // Overview frames the room shell, not the narrower station bounds, so the
  // visible kitchen sits in the middle of the screen.
  const room = roomShell(levelConfig(game.level).kitchenTier, kitchenExpansion(game));
  return {
    target: follow
      ? [(game.human.x - 450) / 65, 0.85, (game.human.y - 270) / 65]
      : [room.center, 0.25, 0],
    zoom: follow
      ? Math.min(width / 8, height / 10)
      : Math.min(
          width / ((bounds.maxX - bounds.minX) / 65 + 7.6),
          height / ((bounds.maxY - bounds.minY) / 65 + 10),
        ),
  };
}

export function moveCamera(
  camera: OrthographicCamera | PerspectiveCamera,
  target: Vector3,
  framing: Framing,
  delta: number,
  reducedMotion: boolean,
  width: number,
  height: number,
): void {
  const approach = (current: number, goal: number): number =>
    reducedMotion ? goal : MathUtils.damp(current, goal, 8, Math.max(0, delta));
  target.x = approach(target.x, framing.target[0]);
  target.y = approach(target.y, framing.target[1]);
  target.z = approach(target.z, framing.target[2]);
  // Move position and look target together so following never rotates the controls.
  camera.position.set(target.x + 10, target.y + 14.75, target.z + 18);
  camera.lookAt(target);
  camera.zoom = approach(camera.zoom, framing.zoom);
  // Lower the kitchen on screen by lifting the camera rig along its own up axis.
  // The screen-space signboards copy the camera transform, so they stay put.
  if (width > 0 && height > 0 && camera.zoom > 0)
    camera.translateY((SCENE_DROP * height) / camera.zoom);
  camera.updateProjectionMatrix();
}
