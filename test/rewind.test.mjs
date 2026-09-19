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
  setPreparationPreview,
  goTo,
  tick,
} from '../src/game.js';
import {
  SHIFT_MS,
  quotaForLevel,
  resolveLayout,
  stationInfo,
  kitchenBounds,
} from '../src/model.js';
import { STAFF } from '../src/staff.js';
import { equipmentState, quoteEquipment } from '../src/equipment.js';

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
    equipment: g.equipment,
    layout: g.layout,
  });
}

function open(level = 9, cash = 1200) {
  storage.set(
    CHECKPOINT_KEY,
    JSON.stringify({
      version: 2,
      level,
      cash,
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

test('equipment investments share the bill and survive retry, reload and preparation rewinds', async () => {
  open();
  const preparation = finish(true);
  const purchases = ['add_board', 'upgrade_board', 'upgrade_pot'];
  const investment = quoteEquipment(preparation.equipment, purchases, 10);
  assert.equal(investment.error, null);
  assert.equal(nextShift(null, 10, ['helper'], purchases), true);
  const opening = economy(useKitchen.getState().game);
  assert.deepEqual(opening.equipment, investment.equipment);
  assert.equal(opening.cash, preparation.cash - 80 - STAFF.helper.wage - investment.cost);
  finish(false);
  assert.equal(retryShift(), true);
  assert.deepEqual(economy(useKitchen.getState().game), opening);
  const reloaded = await import(`../src/game.js?equipment-reload-${Date.now()}`);
  reloaded.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  reloaded.startShift();
  assert.deepEqual(economy(reloaded.useKitchen.getState().game), opening);
  finish(false);
  assert.equal(rollbackToPreparation(), true);
  assert.deepEqual(economy(useKitchen.getState().game), preparation);
  assert.equal(nextShift(null, 10, ['helper'], []), true);
  assert.deepEqual(useKitchen.getState().game.equipment, preparation.equipment);
  assert.equal(useKitchen.getState().game.cash, preparation.cash - 80 - STAFF.helper.wage);
});

test('previous-stage rewind restores the original equipment and rejects invalid investments atomically', () => {
  const previous = open();
  finish(true);
  const before = JSON.stringify(useKitchen.getState().game);
  const saved = storage.get(CHECKPOINT_KEY);
  for (const purchases of [null, {}, ['unknown'], ['add_grill'], ['add_board', 'add_board']]) {
    assert.equal(nextShift(null, 10, ['helper'], purchases), false);
    assert.equal(JSON.stringify(useKitchen.getState().game), before);
    assert.equal(storage.get(CHECKPOINT_KEY), saved);
  }
  const g = useKitchen.getState().game;
  const cash = g.cash;
  g.cash = 80 + STAFF.helper.wage;
  assert.equal(nextShift(null, 10, ['helper'], ['upgrade_board']), false);
  assert.equal(g.equipment.board.level, 1);
  g.cash = cash;
  assert.equal(nextShift(null, 10, ['helper'], ['add_board']), true);
  finish(false);
  assert.equal(rollbackToPreviousStage(), true);
  assert.deepEqual(economy(useKitchen.getState().game), previous);
});

test('legacy saves receive base equipment and malformed or locked equipment is rejected', () => {
  open();
  assert.deepEqual(useKitchen.getState().game.equipment, equipmentState());
  const saved = JSON.parse(storage.get(CHECKPOINT_KEY));
  for (const equipment of [null, {}, { ...equipmentState(), board: { count: 99, level: 1 } }]) {
    storage.set(CHECKPOINT_KEY, JSON.stringify({ ...saved, equipment }));
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.equal(useKitchen.getState().game.level, 1);
    assert.deepEqual(useKitchen.getState().game.equipment, equipmentState());
  }
});

test('kitchen expansion, warming equipment and moved stations persist and rewind together', async () => {
  const previous = open(19, 5000);
  const preparation = finish(true);
  const purchases = ['upgrade_kitchen', 'add_board', 'add_warmer'];
  const investment = quoteEquipment(preparation.equipment, purchases, 20);
  assert.equal(investment.error, null);
  const layout = resolveLayout(
    { level: 20, equipment: investment.equipment },
    { ...preparation.layout, crate: 'board', board: 'crate' },
  );
  assert.ok(layout);
  const cash = preparation.cash;
  const saved = storage.get(CHECKPOINT_KEY);
  setPreparationPreview({ equipment: investment.equipment, layout });
  assert.equal(useKitchen.getState().game.cash, cash);
  assert.deepEqual(economy(useKitchen.getState().game), preparation);
  assert.equal(storage.get(CHECKPOINT_KEY), saved);
  assert.deepEqual(useKitchen.getState().preparationPreview.layout, layout);
  assert.equal(nextShift(null, 12, [], purchases, layout), true);
  assert.equal(useKitchen.getState().preparationPreview, null);
  const opening = economy(useKitchen.getState().game);
  assert.equal(opening.cash, cash - 12 * 8 - investment.cost);
  assert.deepEqual(opening.layout, layout);
  assert.equal(kitchenBounds(useKitchen.getState().game).maxX, 1175 + 130);
  goTo('crate');
  for (let i = 0; i < 60 && !useKitchen.getState().game.human.carrying; i++) tick(0.05);
  const g = useKitchen.getState().game;
  assert.equal(g.human.carrying, 'tomato');
  assert.ok(
    Math.hypot(g.human.x - stationInfo(g, 'crate').x, g.human.y - stationInfo(g, 'crate').y) < 68,
  );
  finish(false);
  assert.equal(retryShift(), true);
  assert.deepEqual(economy(useKitchen.getState().game), opening);
  const reloaded = await import(`../src/game.js?layout-reload-${Date.now()}`);
  reloaded.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  reloaded.startShift();
  assert.deepEqual(economy(reloaded.useKitchen.getState().game), opening);
  finish(false);
  assert.equal(rollbackToPreparation(), true);
  assert.deepEqual(economy(useKitchen.getState().game), preparation);
  assert.equal(nextShift(null, 12, [], purchases, layout), true);
  finish(false);
  assert.equal(rollbackToPreviousStage(), true);
  assert.deepEqual(economy(useKitchen.getState().game), previous);
});

test('invalid placements never spend money or overwrite saves; legacy layouts get defaults', () => {
  open(19);
  finish(true);
  const before = JSON.stringify(useKitchen.getState().game);
  const saved = storage.get(CHECKPOINT_KEY);
  const layout = useKitchen.getState().game.layout;
  for (const invalid of [
    null,
    [],
    { ...layout, crate: 'missing' },
    { ...layout, crate: 'board' },
    { ...layout, crate: 'top_extra' },
  ]) {
    assert.equal(nextShift(null, 12, [], [], invalid), false);
    assert.equal(JSON.stringify(useKitchen.getState().game), before);
    assert.equal(storage.get(CHECKPOINT_KEY), saved);
  }
  const checkpoint = JSON.parse(saved);
  for (const invalid of [
    null,
    { ...checkpoint.layout, crate: 'board' },
    { ...checkpoint.layout, crate: 'missing' },
  ]) {
    storage.set(CHECKPOINT_KEY, JSON.stringify({ ...checkpoint, layout: invalid }));
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.equal(useKitchen.getState().game.level, 1);
    assert.deepEqual(useKitchen.getState().game.layout, resolveLayout(useKitchen.getState().game));
  }
});

test('review refunds hiring, purchases and payroll together, with the same applicants', () => {
  open(9, Math.max(...Object.values(STAFF).map((staff) => staff.cost)) + 1200);
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
