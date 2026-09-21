import assert from 'node:assert/strict';
import test from 'node:test';
import { DROP_DURATION, entranceDuration, entranceHeight } from '../src/entrance.ts';

test('stage pieces fall in sequence, rebound above the floor, and remain landed', () => {
  for (const count of [4, 6, 9]) {
    for (const crew of [0, 1, 4]) {
      const end = entranceDuration(count, crew);
      for (let i = 0; i < count; i++) assert.equal(entranceHeight(end, 0.7 + i * 0.1), 0);
      for (let i = 0; i < crew; i++) assert.equal(entranceHeight(end, 1.4 + i * 0.1), 0);
    }
  }
  assert.equal(entranceHeight(0, 0.4), 8);
  assert.equal(entranceHeight(0.4, 0.4), 8);
  assert.ok(entranceHeight(0.5, 0.4) < entranceHeight(0.5, 0.5));
  assert.ok(Math.abs(entranceHeight(DROP_DURATION * 0.72)) < 1e-12);
  assert.ok(entranceHeight(DROP_DURATION * 0.86) > 0);
  for (let frame = 0; frame <= 180; frame++) {
    const y = entranceHeight(frame / 60, 1.4);
    assert.ok(Number.isFinite(y) && y >= 0 && y <= 8);
  }
  for (const elapsed of [10, 90, 3600, Infinity]) {
    assert.equal(entranceHeight(elapsed, 1.4), 0);
  }
});
