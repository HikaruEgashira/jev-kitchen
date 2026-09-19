import assert from 'node:assert/strict';
import test from 'node:test';
import { levelConfig, MAX_LEVEL, quotaForLevel } from '../src/progression.js';

test('levelConfig clamps input and returns the full 1..100 campaign', () => {
  assert.equal(levelConfig(0).level, 1);
  assert.equal(levelConfig(4.9).level, 4);
  assert.equal(levelConfig(101).level, MAX_LEVEL);
  assert.equal(levelConfig('not-a-level').level, 1);

  for (let level = 1; level <= MAX_LEVEL; level++) {
    const config = levelConfig(level);
    assert.equal(config.level, level);
    assert.ok(config.quota > 0);
    assert.ok(config.orderWindowMs > 0);
    assert.deepEqual(Object.keys(config.recipeMix), ['dish', 'soup', 'roast']);
    assert.ok(
      Math.abs(Object.values(config.recipeMix).reduce((sum, value) => sum + value, 0) - 1) < 1e-12,
    );
  }
});

test('early levels introduce mechanics at their lesson milestones', () => {
  assert.equal(levelConfig(1).quota, 1);
  assert.equal(levelConfig(1).orderWindowMs, Infinity);
  assert.equal(levelConfig(1).staffSlots, 0);
  assert.equal(levelConfig(4).partner, null);
  assert.equal(levelConfig(2).partner, 'veteran');
  assert.equal(levelConfig(3).partner, 'veteran');
  assert.equal(levelConfig(2).kitchenTier, 1);
  assert.equal(levelConfig(3).kitchenTier, 2);
  for (const [feature, first] of [
    ['boostEnabled', 6],
    ['burningEnabled', 6],
    ['fatigueEnabled', 9],
    ['rushEnabled', 10],
  ]) {
    assert.equal(levelConfig(first - 1)[feature], false);
    assert.equal(levelConfig(first)[feature], true);
  }
  assert.equal(levelConfig(6).kitchenTier, 2);
  assert.equal(levelConfig(7).kitchenTier, 3);
  for (const [level, slots] of [
    [7, 1],
    [8, 2],
    [12, 3],
    [16, 4],
  ])
    assert.equal(levelConfig(level).staffSlots, slots);
});

test('the post-Lv10 difficulty curve is numeric, monotonic, and preserves Lv100 targets', () => {
  let previous = levelConfig(10);
  for (let level = 11; level <= MAX_LEVEL; level++) {
    const current = levelConfig(level);
    assert.ok(current.quota >= previous.quota);
    assert.ok(current.orderWindowMs <= previous.orderWindowMs);
    assert.ok(current.difficulty >= previous.difficulty);
    previous = current;
  }

  const lv30 = levelConfig(10);
  const lv31 = levelConfig(11);
  const lv100 = levelConfig(100);
  assert.equal(lv30.difficulty, 0);
  assert.ok(lv31.difficulty > lv30.difficulty);
  assert.equal(lv100.quota, 16);
  assert.equal(lv100.orderWindowMs, 20_000);
  assert.ok(Math.abs(lv100.recipeMix.dish - 0.35) < 1e-12);
  assert.ok(Math.abs(lv100.recipeMix.soup - 0.35) < 1e-12);
  assert.ok(Math.abs(lv100.recipeMix.roast - 0.3) < 1e-12);
  assert.equal(quotaForLevel(100), 16);
});

test('legacy finite-stock transition remains at Lv2', () => {
  assert.equal(levelConfig(1).stockFinite, false);
  assert.equal(levelConfig(2).stockFinite, true);
  assert.equal(levelConfig(4).stockFinite, true);
});

test('new recipes give breathing room, then Lv11..30 rotate production demands', () => {
  assert.ok(quotaForLevel(3) < quotaForLevel(2));
  assert.ok(quotaForLevel(7) < quotaForLevel(6));
  for (let first = 11; first <= 26; first += 5) {
    const week = Array.from({ length: 5 }, (_, i) => levelConfig(first + i));
    assert.equal(new Set(week.map((c) => JSON.stringify(c.recipeMix))).size, 5);
    assert.ok(week[0].recipeMix.dish > 0.5);
    assert.ok(week[1].recipeMix.soup > 0.5);
    assert.ok(week[2].recipeMix.roast > 0.4);
    assert.ok(week.every((c) => c.quota >= 9 && c.quota <= 13 && c.orderWindowMs >= 32000));
  }
});

test('Lv5 repeats Lv4 conditions with a seven-dish quota', () => {
  assert.deepEqual(levelConfig(5), {
    ...levelConfig(4),
    level: 5,
    quota: 7,
    unlockLabel: '同じ厨房で7皿',
  });
  assert.equal(quotaForLevel(6), 7);
  assert.equal(quotaForLevel(7), 6);
});
