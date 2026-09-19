import assert from 'node:assert/strict';
import test from 'node:test';
import {
  useKitchen,
  CHECKPOINT_KEY,
  startShift,
  nextShift,
  retryShift,
  rollbackToPreparation,
  rollbackToPreviousStage,
  tick,
} from '../src/game.js';
import { SHIFT_MS, quotaForLevel } from '../src/model.js';
import { STAFF } from '../src/staff.js';

const storage = new Map();
test.beforeEach(() => {
  storage.clear();
  storage.set('sidekick-onboarded-v1', '1');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  });
  useKitchen.setState({ ready: true, phase: 'ready', menuOpen: false, mode: 'rule', sound: false });
});

function economy(g) {
  return structuredClone({
    level: g.level,
    cash: g.cash,
    stock: g.stock,
    hired: g.hired,
    duty: g.duty,
    staffState: g.staffState,
  });
}

function open(level = 9) {
  storage.set(
    CHECKPOINT_KEY,
    JSON.stringify({
      version: 2,
      level,
      cash: 1200,
      stock: quotaForLevel(level) + 2,
      hired: ['helper'],
      duty: ['helper'],
      staffState: { helper: { worked: 0, rest: 0 } },
      completed: false,
    }),
  );
  startShift();
  assert.equal(useKitchen.getState().game.level, level);
  return economy(useKitchen.getState().game);
}

function finish(cleared) {
  const g = useKitchen.getState().game;
  g.served = cleared ? g.quota : 1;
  g.cash += g.served * 25;
  if (g.stock !== null) g.stock -= g.served;
  g.time = SHIFT_MS;
  tick(0);
  assert.equal(useKitchen.getState().phase, 'finished');
  assert.equal(useKitchen.getState().cleared, cleared);
  return economy(g);
}

test('same-condition retry restores paid opening and keeps the preparation rewind available', () => {
  open();
  finish(true);
  assert.equal(nextShift(null, 10, ['helper']), true);
  const opening = economy(useKitchen.getState().game);
  const rollback = structuredClone(useKitchen.getState().rollback);
  finish(false);
  assert.equal(retryShift(), true);
  assert.deepEqual(economy(useKitchen.getState().game), opening);
  assert.deepEqual(useKitchen.getState().rollback, rollback);
  finish(false);
  assert.equal(rollbackToPreparation(), true);
});

test('review refunds hiring, purchases and payroll together, with the same applicants', () => {
  open();
  const preparation = finish(true);
  const applicants = [...useKitchen.getState().applicants];
  const selected = applicants[0];
  assert.equal(nextShift(selected, 10, ['helper', selected]), true);
  finish(false);
  assert.equal(rollbackToPreparation(), true);
  assert.deepEqual(economy(useKitchen.getState().game), preparation);
  assert.deepEqual(useKitchen.getState().applicants, applicants);
  assert.equal(useKitchen.getState().cleared, true);
  assert.equal(useKitchen.getState().reviewing, true);
  assert.equal(nextShift(null, 6, []), true);
  assert.equal(useKitchen.getState().reviewing, false);
  assert.equal(useKitchen.getState().game.cash, preparation.cash - 6 * 8);
  assert.deepEqual(useKitchen.getState().game.hired, ['helper']);
  assert.deepEqual(useKitchen.getState().game.duty, []);
});

test('review followed by previous-stage rewind restores the original opening, not its profits', () => {
  const previous = open();
  finish(true);
  const applicants = [...useKitchen.getState().applicants];
  assert.equal(nextShift(null, 10, ['helper']), true);
  finish(false);
  assert.equal(rollbackToPreparation(), true);
  assert.equal(nextShift(null, 6, ['helper']), true);
  finish(false);
  assert.equal(rollbackToPreviousStage(), true);
  assert.deepEqual(economy(useKitchen.getState().game), previous);
  finish(true);
  assert.deepEqual(useKitchen.getState().applicants, applicants);
  assert.equal(useKitchen.getState().game.cash, previous.cash + quotaForLevel(9) * 25);
});

test('opening reload retains both rewind boundaries without charging wages twice', async () => {
  open(25);
  finish(true);
  assert.equal(nextShift(null, 12, ['helper']), true);
  const opening = economy(useKitchen.getState().game);
  const history = structuredClone(useKitchen.getState().rollback);
  const reloaded = await import(`../src/game.js?rewind-reload-${Date.now()}`);
  reloaded.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  reloaded.startShift();
  assert.deepEqual(economy(reloaded.useKitchen.getState().game), opening);
  assert.deepEqual(reloaded.useKitchen.getState().rollback, history);
  const g = reloaded.useKitchen.getState().game;
  g.time = SHIFT_MS;
  reloaded.tick(0);
  assert.equal(reloaded.rollbackToPreviousStage(), true);
  assert.equal(reloaded.useKitchen.getState().game.level, 25);
  assert.equal(reloaded.useKitchen.getState().game.cash, 1200);
  assert.equal(reloaded.useKitchen.getState().game.staffState.helper.worked, 0);
  assert.ok(opening.cash < 1200 + quotaForLevel(25) * 25 - STAFF.helper.wage);
});

test('rewinds reject missing history and cannot replace an active shift', () => {
  startShift();
  const opening = useKitchen.getState().game;
  assert.equal(rollbackToPreparation(), false);
  assert.equal(rollbackToPreviousStage(), false);
  assert.equal(useKitchen.getState().game, opening);
  finish(false);
  assert.equal(rollbackToPreparation(), false);
  assert.equal(rollbackToPreviousStage(), false);
});

test('previous-stage retry and reload keep the original applicant draw', async () => {
  open();
  finish(true);
  const applicants = [...useKitchen.getState().applicants];
  assert.equal(nextShift(null, 10, ['helper']), true);
  finish(false);
  assert.equal(rollbackToPreviousStage(), true);
  finish(false);
  assert.equal(retryShift(), true);
  const reloaded = await import(`../src/game.js?rewind-applicants-${Date.now()}`);
  reloaded.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  reloaded.startShift();
  const g = reloaded.useKitchen.getState().game;
  g.served = g.quota;
  g.time = SHIFT_MS;
  reloaded.tick(0);
  assert.deepEqual(reloaded.useKitchen.getState().applicants, applicants);
});

test('reviewing the same preparation twice advances fatigue only once', () => {
  open(25);
  finish(true);
  assert.equal(nextShift(null, 12, ['helper']), true);
  const opening = economy(useKitchen.getState().game);
  assert.equal(opening.staffState.helper.worked, 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    finish(false);
    assert.equal(rollbackToPreparation(), true);
    assert.equal(nextShift(null, 12, ['helper']), true);
    assert.deepEqual(economy(useKitchen.getState().game), opening);
  }
});

test('reloading a reviewed preparation resumes the prior opening without rerolling applicants', async () => {
  const opening = open();
  finish(true);
  const applicants = [...useKitchen.getState().applicants];
  assert.equal(nextShift(null, 10, ['helper']), true);
  finish(false);
  useKitchen.setState({ ready: false });
  for (const action of [retryShift, rollbackToPreparation, rollbackToPreviousStage])
    assert.equal(action(), false);
  useKitchen.setState({ ready: true });
  assert.equal(rollbackToPreparation(), true);
  const reloaded = await import(`../src/game.js?review-reload-${Date.now()}`);
  reloaded.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  reloaded.startShift();
  const g = reloaded.useKitchen.getState().game;
  assert.deepEqual(economy(g), opening);
  g.served = g.quota;
  g.time = SHIFT_MS;
  reloaded.tick(0);
  assert.deepEqual(reloaded.useKitchen.getState().applicants, applicants);
});
