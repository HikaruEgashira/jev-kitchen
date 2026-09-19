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

test('new play patterns unlock at each five-level milestone through Lv30', () => {
  const lv1 = levelConfig(1);
  assert.equal(lv1.kitchenTier, 1);
  assert.equal(lv1.orderWindowMs, levelConfig(4).orderWindowMs);
  assert.equal(lv1.quota, 6);
  assert.equal(lv1.staffSlots, 1);
  assert.equal(lv1.boostEnabled, false);
  assert.equal(lv1.burningEnabled, false);
  assert.equal(lv1.fatigueEnabled, false);
  assert.equal(lv1.rushEnabled, false);
  assert.deepEqual(lv1.recipeMix, { dish: 1, soup: 0, roast: 0 });

  const lv5 = levelConfig(5);
  assert.equal(lv5.kitchenTier, 2);
  assert.ok(lv5.orderWindowMs < lv1.orderWindowMs);
  assert.equal(lv5.quota, 7);
  assert.ok(lv5.recipeMix.soup > 0);
  assert.equal(lv5.staffSlots, 1);
  assert.equal(lv5.unlockLabel, 'スープ鍋');

  const lv10 = levelConfig(10);
  assert.equal(lv10.kitchenTier, 3);
  assert.ok(lv10.recipeMix.roast > 0);
  assert.equal(lv10.staffSlots, 2);
  assert.equal(lv10.unlockLabel, 'グリル・2人稼働');

  assert.equal(levelConfig(15).boostEnabled, true);
  assert.equal(levelConfig(15).unlockLabel, '仕上げブースト');
  assert.equal(levelConfig(20).burningEnabled, true);
  assert.equal(levelConfig(20).staffSlots, 3);
  assert.equal(levelConfig(20).unlockLabel, '焦げ管理・3人稼働');
  assert.equal(levelConfig(25).fatigueEnabled, true);
  assert.equal(levelConfig(25).staffSlots, 3);
  assert.equal(levelConfig(25).unlockLabel, '連勤と休み');
  assert.equal(levelConfig(30).rushEnabled, true);
  assert.equal(levelConfig(30).staffSlots, 4);
  assert.equal(levelConfig(30).unlockLabel, 'ラッシュ注文・4人稼働');
});

test('the post-Lv30 difficulty curve is numeric, monotonic, and preserves Lv100 targets', () => {
  let previous = levelConfig(1);
  for (let level = 2; level <= MAX_LEVEL; level++) {
    const current = levelConfig(level);
    assert.ok(current.quota >= previous.quota);
    assert.ok(current.orderWindowMs <= previous.orderWindowMs);
    assert.ok(current.difficulty >= previous.difficulty);
    previous = current;
  }

  const lv30 = levelConfig(30);
  const lv31 = levelConfig(31);
  const lv100 = levelConfig(100);
  assert.equal(lv30.difficulty, 0);
  assert.ok(lv31.difficulty > lv30.difficulty);
  assert.equal(lv100.quota, 14);
  assert.equal(lv100.orderWindowMs, 20_000);
  assert.ok(Math.abs(lv100.recipeMix.dish - 0.35) < 1e-12);
  assert.ok(Math.abs(lv100.recipeMix.soup - 0.35) < 1e-12);
  assert.ok(Math.abs(lv100.recipeMix.roast - 0.3) < 1e-12);
  assert.equal(quotaForLevel(100), 14);
});

test('legacy finite-stock transition remains at Lv2', () => {
  assert.equal(levelConfig(1).stockFinite, false);
  assert.equal(levelConfig(2).stockFinite, true);
  assert.equal(levelConfig(4).stockFinite, true);
});
