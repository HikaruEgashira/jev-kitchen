import assert from 'node:assert/strict';
import test from 'node:test';
import { DROP_DURATION, ENTRANCE_DURATION, entranceHeight } from '../src/entrance.js';

test('stage pieces fall in sequence, rebound above the floor, and remain landed', () => {
  assert.equal(entranceHeight(0, 0.4), 8);
  assert.equal(entranceHeight(0.4, 0.4), 8);
  assert.ok(entranceHeight(0.5, 0.4) < entranceHeight(0.5, 0.5));
  assert.ok(Math.abs(entranceHeight(DROP_DURATION * 0.72)) < 1e-12);
  assert.ok(entranceHeight(DROP_DURATION * 0.86) > 0);
  for (let frame = 0; frame <= 180; frame++) {
    const y = entranceHeight(frame / 60, 1.4);
    assert.ok(Number.isFinite(y) && y >= 0 && y <= 8);
  }
  for (const elapsed of [ENTRANCE_DURATION, 90, 3600, Infinity]) {
    assert.equal(entranceHeight(elapsed, 1.4), 0);
  }
});
