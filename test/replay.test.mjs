import assert from 'node:assert/strict';
import test from 'node:test';
import { drawApplicants, seededRandom } from '../src/applicants.js';
import { runReplayCampaign, RANKED_PROTOCOL } from '../src/replay.js';

// The verified score must not depend on wall-clock time or client state.
test('campaign replay is deterministic for the same seed and decisions', () => {
  const decisions = ['fetch_tomato', 'chop', 'fetch_plate', 'plate', 'serve'];
  const first = runReplayCampaign({ seed: 42, decisions });
  const second = runReplayCampaign({ seed: 42, decisions });
  assert.deepEqual(first, second);
  assert.equal(first.protocol, RANKED_PROTOCOL);
  assert.ok(first.clearedLevels >= 1, 'a full salad chain must clear Lv1');
  assert.equal(first.decisionsUsed, decisions.length);
});

test('campaign replay consumes the recorded order and stops when it runs out', () => {
  const short = runReplayCampaign({ seed: 1, decisions: [] });
  assert.equal(short.truncated, true);
  assert.equal(short.clearedLevels, 0);
  assert.equal(short.decisionsUsed, 0);
});

test('seeded applicants are reproducible and drive the verified hires', () => {
  const hired = ['helper'];
  const a = [];
  const randomA = seededRandom(7);
  for (let i = 0; i < 3; i++) a.push(drawApplicants(hired, randomA));
  const randomB = seededRandom(7);
  const b = [];
  for (let i = 0; i < 3; i++) b.push(drawApplicants(hired, randomB));
  assert.deepEqual(a, b);
  const different = drawApplicants(hired, seededRandom(8));
  assert.notDeepEqual(a, different);
});

test('a diverged decision cannot silently clear a level', () => {
  const bogus = runReplayCampaign({ seed: 3, decisions: ['definitely_not_an_action'] });
  assert.equal(bogus.clearedLevels, 0);
});
