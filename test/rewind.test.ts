import assert from 'node:assert/strict';
import test from 'node:test';
import {
  useKitchen,
  CHECKPOINT_KEY,
  STAGES_KEY,
  restoreStage,
  startShift,
  nextShift,
  retryShift,
  rollbackToPreparation,
  rollbackToPreviousStage,
  setPreparationPreview,
  goTo,
  tick,
} from '../src/game.ts';
import {
  SHIFT_MS,
  CHOP_MS,
  SPEED,
  quotaForLevel,
  resolveLayout,
  stationInfo,
  kitchenBounds,
  interact,
} from '../src/model.ts';
import { STAFF } from '../src/staff.ts';
import { equipmentState, quoteEquipment } from '../src/equipment.ts';
import { VITAMINS } from '../src/training.ts';
import type { GameState } from '../src/types.ts';

const storage = new Map();
test.beforeEach(() => {
  storage.clear();
  storage.set('sidekick-onboarded-v1', '1');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: unknown) => storage.set(key, String(value)),
    },
  });
  useKitchen.setState({
    ready: true,
    phase: 'ready',
    menuOpen: false,
    mode: 'rule',
    sound: false,
    stages: {},
  });
});

function economy(g: GameState) {
  return structuredClone({
    level: g.level,
    cash: g.cash,
    stock: g.stock,
    hired: g.hired,
    duty: g.duty,
    staffState: g.staffState,
    equipment: g.equipment,
    training: g.training,
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

function finish(cleared: boolean) {
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

test('stage selection imports legacy history and preserves future openings across replay and reload', async () => {
  const stage9 = open(9, 9000);
  const afterStage9 = finish(true);
  assert.equal(nextShift(null, 10, ['helper'], ['upgrade_board']), true);
  const stage10 = economy(useKitchen.getState().game);
  const afterStage10 = finish(true);
  assert.equal(nextShift(null, 10, ['helper']), true);
  // Simulate a pre-archive save containing only the existing rewind chain.
  storage.delete(STAGES_KEY);
  useKitchen.setState({ stages: {} });
  const reloaded = await import(`../src/game.ts?stage-migration-${Date.now()}`);
  reloaded.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  assert.deepEqual(Object.keys(reloaded.useKitchen.getState().stages), ['9', '10', '11']);
  assert.equal(reloaded.restoreStage(9), true);
  assert.deepEqual(economy(reloaded.useKitchen.getState().game), stage9);
  const future = JSON.parse(storage.get(STAGES_KEY))['11'];
  assert.equal(reloaded.restoreStage(10), false, 'cannot replace an active shift');
  const replay = reloaded.useKitchen.getState().game;
  replay.served = replay.quota;
  replay.cash += replay.served * 25;
  replay.stock -= replay.served;
  replay.time = SHIFT_MS;
  reloaded.tick(0);
  assert.equal(reloaded.nextShift(null, 10, ['helper']), true);
  assert.notDeepEqual(economy(reloaded.useKitchen.getState().game), stage10);
  reloaded.useKitchen.setState({ phase: 'paused', menuOpen: true });
  // Selecting a stage resumes on its opening preparation, not its paid opening.
  assert.equal(reloaded.restoreStage(10), true);
  assert.deepEqual(economy(reloaded.useKitchen.getState().game), afterStage9);
  assert.equal(reloaded.useKitchen.getState().phase, 'finished');
  assert.equal(reloaded.useKitchen.getState().cleared, true);
  assert.equal(reloaded.useKitchen.getState().menuOpen, false);
  assert.deepEqual(JSON.parse(storage.get(STAGES_KEY))['11'], future);
  const again = await import(`../src/game.ts?stage-reload-${Date.now()}`);
  again.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  assert.equal(again.restoreStage(11), true);
  assert.deepEqual(economy(again.useKitchen.getState().game), afterStage10);
  assert.equal(again.useKitchen.getState().game.time, 0);
  assert.deepEqual(JSON.parse(storage.get(STAGES_KEY))['11'], future);
});

test('clearing a shift registers the next stage, which reopens on its preparation', () => {
  open(9, 9000);
  const finished = finish(true);
  const applicants = [...useKitchen.getState().applicants];
  // The next stage is on record before 開店, as a valid default opening.
  const next = useKitchen.getState().stages['10'];
  assert.equal(next?.level, 10);
  assert.ok(next.rollback?.preparation);
  assert.ok((next.stock ?? 0) >= quotaForLevel(10));
  // Selecting it resumes the preparation screen backed by the finished Lv9 state.
  useKitchen.setState({ phase: 'paused' });
  assert.equal(restoreStage(10), true);
  assert.equal(useKitchen.getState().phase, 'finished');
  assert.equal(useKitchen.getState().cleared, true);
  assert.deepEqual(economy(useKitchen.getState().game), finished);
  assert.deepEqual(useKitchen.getState().applicants, applicants);
});

test('stage selection rejects unknown saves and benchmark use without any persistent writes', () => {
  open();
  useKitchen.setState({ phase: 'paused' });
  const before = [...storage];
  for (const level of [0, 10, '9', NaN, Infinity])
    assert.equal(restoreStage(level as number), false);
  useKitchen.setState({ benchmark: true });
  assert.equal(restoreStage(9), false);
  assert.deepEqual([...storage], before);
  useKitchen.setState({ benchmark: false });
});

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
  const reloaded = await import(`../src/game.ts?equipment-reload-${Date.now()}`);
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

test('vitamins boost one actor and survive retry, reload and preparation rewinds', async () => {
  open(9, 1200);
  const preparation = finish(true);
  const vitamins = [
    { item: 'move', target: 'human' },
    { item: 'cook', target: 'human' },
  ];
  assert.equal(nextShift(null, 10, ['helper'], [], undefined, vitamins), true);
  const opening = economy(useKitchen.getState().game);
  assert.deepEqual(opening.training, { human: { move: 1, cook: 1 } });
  assert.equal(
    opening.cash,
    preparation.cash - 10 * 8 - STAFF.helper.wage - VITAMINS.move.cost - VITAMINS.cook.cost,
  );

  const playing = useKitchen.getState().game;
  playing.human.carrying = 'tomato';
  interact(playing, 'human', 'board');
  assert.equal(playing.stations.board.duration, Math.round(CHOP_MS * 0.96));

  playing.human.x = 300;
  playing.human.y = 190;
  goTo('crate');
  const before = playing.human.x;
  tick(0.1);
  assert.ok(Math.abs(before - playing.human.x - SPEED * 1.04 * 0.1) < 0.5);

  finish(false);
  assert.equal(retryShift(), true);
  assert.deepEqual(economy(useKitchen.getState().game), opening);
  const reloaded = await import(`../src/game.ts?vitamin-reload-${Date.now()}`);
  reloaded.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  reloaded.startShift();
  assert.deepEqual(economy(reloaded.useKitchen.getState().game), opening);
  finish(false);
  assert.equal(rollbackToPreparation(), true);
  assert.deepEqual(economy(useKitchen.getState().game), preparation);
});

test('previous-stage rewind restores the original equipment and rejects invalid investments atomically', () => {
  const previous = open();
  finish(true);
  const before = JSON.stringify(useKitchen.getState().game);
  const saved = storage.get(CHECKPOINT_KEY);
  for (const purchases of [
    null,
    {},
    ['unknown'],
    ['add_grill', 'add_grill'],
    ['add_board', 'add_board'],
  ]) {
    assert.equal(nextShift(null, 10, ['helper'], purchases as string[]), false);
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
  assert.deepEqual(useKitchen.getState().game.equipment, equipmentState(undefined));
  const saved = JSON.parse(storage.get(CHECKPOINT_KEY));
  for (const equipment of [
    null,
    {},
    { ...equipmentState(undefined), board: { count: 99, level: 1 } },
  ]) {
    storage.set(CHECKPOINT_KEY, JSON.stringify({ ...saved, equipment }));
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.equal(useKitchen.getState().game.level, 1);
    assert.deepEqual(useKitchen.getState().game.equipment, equipmentState(undefined));
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
  assert.deepEqual(useKitchen.getState().preparationPreview!.layout, layout);
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
    Math.hypot(g.human.x - stationInfo(g, 'crate')!.x, g.human.y - stationInfo(g, 'crate')!.y) < 68,
  );
  finish(false);
  assert.equal(retryShift(), true);
  assert.deepEqual(economy(useKitchen.getState().game), opening);
  const reloaded = await import(`../src/game.ts?layout-reload-${Date.now()}`);
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
  assert.equal(nextShift(null, 9, []), true);
  assert.equal(useKitchen.getState().reviewing, false);
  assert.equal(useKitchen.getState().game.cash, preparation.cash - 9 * 8);
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
  assert.equal(nextShift(null, 9, ['helper']), true);
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
  const reloaded = await import(`../src/game.ts?rewind-reload-${Date.now()}`);
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
  open(3);
  const opening = useKitchen.getState().game;
  assert.equal(rollbackToPreparation(), false);
  assert.equal(rollbackToPreviousStage(), false);
  assert.equal(useKitchen.getState().game, opening);
  finish(false);
  assert.equal(rollbackToPreparation(), false);
  assert.equal(rollbackToPreviousStage(), false);
});

test('previous-stage rewind keeps both recovery choices for the next failure', () => {
  open(9);
  finish(true);
  assert.equal(nextShift(null, undefined, undefined), true);
  finish(true);
  assert.equal(nextShift(null, undefined, undefined), true);
  finish(false);
  assert.equal(rollbackToPreviousStage(), true);
  assert.equal(useKitchen.getState().game.level, 10);
  finish(false);
  const rollback = useKitchen.getState().rollback;
  assert.equal(Boolean(rollback?.preparation), true);
  assert.equal(Boolean(rollback?.previous), true);
  assert.equal(rollbackToPreparation(), true);
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
  const reloaded = await import(`../src/game.ts?rewind-applicants-${Date.now()}`);
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
  const reloaded = await import(`../src/game.ts?review-reload-${Date.now()}`);
  reloaded.useKitchen.setState({ ready: true, sound: false, mode: 'rule' });
  reloaded.startShift();
  const g = reloaded.useKitchen.getState().game;
  assert.deepEqual(economy(g), opening);
  g.served = g.quota;
  g.time = SHIFT_MS;
  reloaded.tick(0);
  assert.deepEqual(reloaded.useKitchen.getState().applicants, applicants);
});
