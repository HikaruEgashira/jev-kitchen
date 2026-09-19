import { MathUtils } from 'three/webgpu';
import { kitchenBounds } from './model.js';

// Fraction of the screen height the kitchen render is lowered by.
export const SCENE_DROP = 0.06;

export function cameraFraming(game, phase, mode, width, height, entranceComplete = true) {
  const bounds = kitchenBounds(game);
  const follow =
    entranceComplete &&
    ['ready', 'playing', 'paused'].includes(phase) &&
    (mode === 'follow' || (mode === 'auto' && width < height));
  const x = follow ? game.human.x : (bounds.minX + bounds.maxX) / 2;
  const y = follow ? game.human.y : (bounds.minY + bounds.maxY) / 2;
  return {
    target: [(x - 450) / 65, follow ? 0.85 : 0.25, (y - 270) / 65],
    zoom: follow
      ? Math.min(width / 8, height / 10)
      : Math.min(
          width / ((bounds.maxX - bounds.minX) / 65 + 7.6),
          height / ((bounds.maxY - bounds.minY) / 65 + 10),
        ),
  };
}

export function moveCamera(camera, target, framing, delta, reducedMotion, width, height) {
  const approach = (current, goal) =>
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
