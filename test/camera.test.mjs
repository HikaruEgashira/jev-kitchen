import assert from 'node:assert/strict';
import test from 'node:test';
import { OrthographicCamera, Vector3 } from 'three/webgpu';
import { cameraFraming, moveCamera } from '../src/camera.js';
import { createGame, kitchenBounds } from '../src/model.js';

test('automatic camera follows in portrait, fits in landscape, and honors explicit modes', () => {
  const g = createGame({ level: 10 });
  const follow = cameraFraming(g, 'playing', 'follow', 320, 568);
  const overview = cameraFraming(g, 'playing', 'overview', 320, 568);
  assert.deepEqual(cameraFraming(g, 'playing', 'auto', 320, 568), follow);
  assert.deepEqual(cameraFraming(g, 'paused', 'auto', 320, 568), follow);
  assert.deepEqual(
    cameraFraming(g, 'playing', 'auto', 568, 320),
    cameraFraming(g, 'playing', 'overview', 568, 320),
  );
  assert.deepEqual(cameraFraming(g, 'finished', 'follow', 320, 568), overview);
  assert.deepEqual(cameraFraming(g, 'ready', 'auto', 320, 568, false), overview);
  assert.deepEqual(cameraFraming(g, 'ready', 'auto', 320, 568, true), follow);
  assert.deepEqual(cameraFraming(g, 'ready', 'overview', 320, 568, true), overview);
});

test('portrait follow enlarges the player and keeps their body clear of the fixed HUD', () => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
  ]) {
    for (const level of [1, 5, 10, 20, 30, 100]) {
      const g = createGame({ level });
      const bounds = kitchenBounds(g);
      const camera = new OrthographicCamera(
        -width / 2,
        width / 2,
        height / 2,
        -height / 2,
        0.1,
        100,
      );
      const target = new Vector3();
      for (const x of [bounds.minX, bounds.maxX]) {
        for (const y of [bounds.minY, bounds.maxY]) {
          Object.assign(g.human, { x, y });
          const framing = cameraFraming(g, 'playing', 'auto', width, height);
          assert.ok(
            framing.zoom >= cameraFraming(g, 'playing', 'overview', width, height).zoom * 2,
          );
          moveCamera(camera, target, framing, 1 / 60, true);
          camera.updateMatrixWorld();
          for (const bodyHeight of [0, 1.8]) {
            const projected = new Vector3((x - 450) / 65, bodyHeight, (y - 270) / 65).project(
              camera,
            );
            const screenY = ((1 - projected.y) * height) / 2;
            assert.ok(Math.abs(projected.x) < 0.01);
            assert.ok(
              screenY > 196 && screenY < height - 160,
              `body obscured at ${width}x${height}`,
            );
          }
        }
      }
    }
  }
});

test('following eases without overshoot or camera rotation, and reduced motion snaps', () => {
  const g = createGame();
  const camera = new OrthographicCamera(-160, 160, 284, -284, 0.1, 100);
  const target = new Vector3();
  moveCamera(camera, target, cameraFraming(g, 'playing', 'auto', 320, 568), 0, true);
  const rotation = camera.quaternion.clone();
  const before = target.clone();
  g.human.x += 200;
  const framing = cameraFraming(g, 'playing', 'auto', 320, 568);
  moveCamera(camera, target, framing, 1 / 60, false);
  assert.ok(target.x > before.x && target.x < framing.target[0]);
  assert.ok(Math.abs(camera.quaternion.dot(rotation)) > 0.999999);
  for (let frame = 0; frame < 120; frame++) moveCamera(camera, target, framing, 1 / 60, false);
  assert.ok(Math.abs(target.x - framing.target[0]) < 0.0001);
  const overview = cameraFraming(g, 'playing', 'overview', 568, 320);
  moveCamera(camera, target, overview, 1 / 60, true);
  assert.deepEqual(target.toArray(), overview.target);
  assert.equal(camera.zoom, overview.zoom);
});
