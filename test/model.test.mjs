import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGame,
  interact,
  advance,
  buildCandidates,
  buildQuestions,
  observe,
  isFeasible,
  rulePick,
  CHOP_MS,
  COOK_MS,
  GRILL_MS,
  POT_BURN_MS,
  GRILL_BURN_MS,
  SHIFT_MS,
  MAX_LEVEL,
  STOCK_PRICE,
  levelConfig,
  quotaForLevel,
  discard,
  dash,
  actionHint,
  ITEM_EMOJI,
  activeStationIds,
  kitchenBounds,
  layoutSlots,
  resolveLayout,
  stationInfo,
  actor,
  stationKind,
  burnGraceMs,
  handoffOption,
  handoff,
  REACH,
} from '../src/model.js';
import { nextStaffState, payroll, staffAvailable, STAFF, staffPerformance } from '../src/staff.js';

test('the four-step pipeline produces one served dish', () => {
  const g = createGame({ level: 3, stock: 99 });

  assert.equal(interact(g, 'ai', 'crate').ok, true);
  assert.equal(g.ai.carrying, 'tomato');

  assert.equal(interact(g, 'ai', 'board').ok, true);
  assert.equal(g.ai.carrying, null);
  assert.equal(g.stations.board.state, 'chopping');
  assert.equal(g.stations.board.by, 'ai');

  // The first kitchen teaches the basic pipeline before boosts unlock.
  g.time += CHOP_MS / 2;
  advance(g);
  assert.equal(g.stations.board.state, 'chopping');
  assert.equal(interact(g, 'human', 'board').ok, false);

  g.time += CHOP_MS;
  advance(g);
  assert.equal(g.stations.board.state, 'chopped');

  assert.equal(interact(g, 'ai', 'plates').ok, true);
  assert.equal(g.ai.carrying, 'plate');

  assert.equal(interact(g, 'ai', 'board').ok, true);
  assert.equal(g.ai.carrying, 'dish');
  assert.equal(g.stations.board.state, 'idle');

  assert.equal(interact(g, 'ai', 'serve').ok, true);
  assert.equal(g.served, 1);
});

test('candidates track carrying and board state, and always allow waiting', () => {
  const g = createGame({ level: 3, stock: 99 });
  const fresh = buildCandidates(g);
  assert.ok(fresh.some((c) => c.id === 'fetch_tomato'));
  assert.ok(fresh.some((c) => c.id === 'wait'));
  // A plate is only worth fetching once there is something to plate.
  assert.ok(!fresh.some((c) => c.id === 'fetch_plate'));

  g.ai.carrying = 'plate';
  g.stations.board.state = 'chopped';
  const ready = buildCandidates(g);
  assert.ok(ready.some((c) => c.id === 'plate'));
  assert.ok(!ready.some((c) => c.id === 'fetch_tomato'));
});

test('a decision that went stale while Jev was thinking is not feasible', () => {
  const g = createGame({ level: 3, stock: 99 });
  g.ai.carrying = 'plate';
  g.stations.board.state = 'chopped';
  const cand = buildCandidates(g).find((c) => c.id === 'plate');
  assert.equal(isFeasible(g, cand), true);

  // The human finishes the dish first; the AI's answer is now wrong.
  g.stations.board.state = 'idle';
  assert.equal(isFeasible(g, cand), false);
});

test('standing at a station never blocks a partner from freeing it', () => {
  const g = createGame({ level: 3, stock: 99 });
  g.human.station = 'crate';
  const picked = rulePick(g, buildCandidates(g));
  assert.equal(picked.id, 'fetch_tomato');

  g.human.station = null;
  const picked2 = rulePick(g, buildCandidates(g));
  assert.equal(picked2.id, 'fetch_tomato'); // its highest-priority useful move
  g.human.station = 'serve';
  g.ai.carrying = 'soup';
  g.orders = [{ recipe: 'soup', deadline: 30000 }];
  assert.equal(rulePick(g, buildCandidates(g)).id, 'serve');
  g.human.station = 'board';
  g.ai.carrying = 'tomato';
  assert.equal(rulePick(g, buildCandidates(g)).id, 'chop');
  g.ai.carrying = null;
  g.human.carrying = 'tomato';
  g.stations.board.state = 'chopped';
  assert.equal(rulePick(g, buildCandidates(g)).id, 'collect');
});

test('a second board allows two cooks to fetch ingredients in parallel', () => {
  const g = createGame({
    level: 8,
    stock: 10,
    duty: ['helper', 'sous'],
    hired: ['helper', 'sous'],
    equipment: { board: { count: 2, level: 1 } },
  });
  g.human.carrying = 'tomato';
  assert.ok(buildCandidates(g, 'helper').some((c) => c.id === 'fetch_tomato'));
  g.crew.helper.intent = { id: 'fetch_tomato', station: 'crate' };
  assert.ok(!buildCandidates(g, 'sous').some((c) => c.id === 'fetch_tomato'));
});

test('nearby handoffs preserve items and quality and reject stale, busy or absent partners', () => {
  const g = createGame({
    level: 8,
    stock: 10,
    hired: ['helper', 'sous'],
    duty: ['helper', 'sous'],
  });
  Object.assign(g.human, {
    x: 500,
    y: 300,
    carrying: 'soup',
    quality: true,
    intent: { id: 'serve' },
  });
  Object.assign(g.crew.helper, { x: 520, y: 300, intent: { id: 'fetch_tomato' } });
  Object.assign(g.crew.sous, { x: 550, y: 300 });
  assert.equal(handoffOption(g).partner, 'helper');
  const candidate = buildCandidates(g, 'human').find((c) => c.partner === 'helper');
  assert.equal(candidate.partner, 'helper');
  const before = [g.stock, g.cash, g.served];
  assert.equal(handoff(g, 'helper').ok, true);
  assert.equal(g.human.carrying, null);
  assert.equal(g.crew.helper.carrying, 'soup');
  assert.equal(g.crew.helper.quality, true);
  assert.equal(g.human.quality, false);
  assert.equal(g.human.intent, null);
  assert.equal(g.crew.helper.intent, null);
  assert.ok(!buildCandidates(g, 'helper').some((c) => c.id.startsWith('handoff_')));
  assert.equal(isFeasible(g, candidate, 'human'), false);
  assert.deepEqual([g.stock, g.cash, g.served], before);
  assert.equal(handoff(g, 'helper').ok, false);
  g.human.carrying = 'tomato';
  g.crew.helper.carrying = 'plate';
  g.crew.sous.x = g.human.x + REACH + 1;
  assert.equal(handoffOption(g), null);
  g.crew.helper.carrying = null;
  g.duty = ['sous'];
  assert.equal(handoff(g, 'helper').ok, false);
  g.crew.sous.x = 500;
  g.time = g.duration;
  assert.equal(handoffOption(g), null);
});

test('unknown actions are never feasible', () => {
  const g = createGame({ level: 3, stock: 99 });
  assert.equal(isFeasible(g, { id: 'fly_to_moon' }), false);
  assert.equal(isFeasible(g, null), false);
});

test('candidate instructions include the serving end of both recipes', () => {
  const instructions = buildQuestions(buildCandidates(createGame({ level: 3, stock: 99 })))
    .next_action.instructions;
  assert.match(instructions, /Salad: tomato → chop → plate → serve/);
  assert.match(instructions, /Soup: tomato → chop → collect → pot → plate → serve/);
  assert.match(instructions, /Grilled tomato: tomato → chop → collect → grill → plate → serve/);
  assert.equal(ITEM_EMOJI.chopped, '🍅');
});

test('tutorial is unlimited and ordinary kitchens use a 90-second contract', () => {
  const level1 = createGame();
  assert.equal(level1.level, 1);
  assert.equal(level1.quota, 1);
  assert.equal(level1.duration, Infinity);
  assert.equal(level1.stock, null);
  assert.deepEqual(activeStationIds(level1), ['crate', 'board', 'plates', 'serve']);
  assert.deepEqual(kitchenBounds(level1), { minX: 85, maxX: 775, minY: 175, maxY: 402 });
  assert.ok(level1.orders.every((o) => o.recipe === 'dish'));

  const level2 = createGame({ level: 5, stock: 8 });
  assert.equal(level2.quota, 7);
  assert.equal(level2.duration, SHIFT_MS);
  assert.equal(level2.stock, 8);
  assert.deepEqual(
    level2.orders.map((o) => o.recipe),
    ['soup', 'dish'],
  );
  assert.ok(activeStationIds(level2).includes('pot'));
  assert.equal(activeStationIds(level2).includes('grill'), false);
  assert.equal(kitchenBounds(level2).maxX, 975);

  const level3 = createGame({
    level: 10,
    cash: 200,
    staffId: 'chef',
    hired: ['helper', 'chef'],
    stock: 10,
  });
  assert.equal(level3.quota, 8);
  assert.equal(level3.duration, SHIFT_MS);
  assert.equal(level3.cash, 200);
  assert.deepEqual(level3.hired, ['helper', 'chef']);
  assert.equal(level3.staffId, 'chef');
  assert.deepEqual(
    level3.orders.map((o) => o.recipe),
    ['roast', 'soup'],
  );
  assert.ok(activeStationIds(level3).includes('grill'));
  assert.equal(kitchenBounds(level3).maxX, 1175);
  assert.equal(MAX_LEVEL, 100);
  assert.deepEqual(
    [1, 5, 10, 15, 20, 25, 30, 100].map((level) => levelConfig(level).quota),
    [1, 7, 8, 9, 10, 11, 12, 16],
  );
  assert.equal(levelConfig(0).level, 1);
  assert.equal(levelConfig(101).level, MAX_LEVEL);
  assert.equal(quotaForLevel(4), 6);
});

test('initial and replenished tickets share the level formula', () => {
  const g = createGame({ level: 2, stock: 3 });
  const window = levelConfig(2).orderWindowMs;
  assert.deepEqual(
    g.orders.map((ticket) => ticket.deadline),
    [window, Math.round((window * 4) / 3)],
  );
  g.human.carrying = g.orders[0].recipe;
  assert.equal(interact(g, 'human', 'serve').ok, true);
  assert.equal(g.orders.at(-1).deadline, levelConfig(2).orderWindowMs);

  const high = createGame({ level: 100, stock: 20 });
  assert.ok(high.orders.every((ticket) => ['dish', 'soup', 'roast'].includes(ticket.recipe)));
  const highWindow = levelConfig(MAX_LEVEL).orderWindowMs;
  assert.deepEqual(
    high.orders.map((ticket) => ticket.deadline),
    [highWindow, Math.round((highWindow * 4) / 3)],
  );
});

test('all 100 levels follow a bounded curve and reproducible recipe proportions', () => {
  let previous = levelConfig(1);
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const config = levelConfig(level);
    assert.ok(config.quota >= 1 && config.quota <= 16);
    assert.ok(config.orderWindowMs <= previous.orderWindowMs && config.orderWindowMs >= 20_000);
    assert.ok(
      Math.abs(Object.values(config.recipeMix).reduce((sum, value) => sum + value, 0) - 1) < 1e-12,
    );
    const g = createGame({ level, stock: 99 });
    assert.equal(g.duration, level === 1 ? Infinity : SHIFT_MS);
    assert.deepEqual(g.orders, createGame({ level, stock: 99 }).orders);
    if (level === 1) continue;
    const counts = { dish: 0, soup: 0, roast: 0 };
    for (let index = 0; index < 300; index++) {
      const recipe = g.orders[0].recipe;
      counts[recipe]++;
      g.human.carrying = recipe;
      assert.equal(interact(g, 'human', 'serve').ok, true);
    }
    for (const recipe of Object.keys(counts)) {
      assert.ok(Math.abs(counts[recipe] / 300 - config.recipeMix[recipe]) < 0.02);
      if (config.recipeMix[recipe] === 0) assert.equal(counts[recipe], 0);
    }
    previous = config;
  }
});

test('board boost preserves base duration and never delays fast staff at the window edges', () => {
  for (const who of ['human', 'chef']) {
    for (const progress of [0.25, 0.65]) {
      const g = createGame({ level: 15, stock: 2, hired: ['helper', 'chef'], duty: ['chef'] });
      g.time = 1000;
      (who === 'human' ? g.human : g.crew[who]).carrying = 'tomato';
      assert.equal(interact(g, who, 'board').ok, true);
      const board = g.stations.board;
      const { duration, startedAt, busyUntil } = board;
      assert.equal(duration, who === 'human' ? CHOP_MS : Math.round(CHOP_MS * 0.55));
      advance(g, duration * progress);
      assert.ok(buildCandidates(g, 'human').some((c) => c.id === 'boost_board'));
      assert.equal(interact(g, 'human', 'board').ok, true);
      assert.ok(board.busyUntil <= busyUntil, `${who} at ${progress}: boost delayed completion`);
      assert.equal(board.duration, duration);
      assert.equal(board.startedAt, startedAt);
      assert.equal(board.quality, true);
      assert.equal(interact(g, 'human', 'board').ok, false);
      advance(g, board.busyUntil - g.time - 1);
      assert.equal(board.state, 'chopping');
      advance(g, 1);
      assert.equal(board.state, 'chopped');
      assert.equal(interact(g, 'human', 'board').ok, true);
      assert.equal(board.duration, 0);
    }
  }
});

test('human boost is a one-shot quality bonus and AI cannot farm it', () => {
  const g = createGame({ level: 15, stock: 2 });
  g.orders[0].recipe = 'dish';
  assert.equal(interact(g, 'human', 'crate').ok, true);
  assert.equal(interact(g, 'human', 'board').ok, true);
  advance(g, CHOP_MS * 0.4);
  assert.ok(buildCandidates(g, 'human').some((c) => c.id === 'boost_board'));
  assert.equal(
    buildCandidates(g, 'ai').some((c) => c.id === 'boost_board'),
    false,
  );
  const busyBefore = g.stations.board.busyUntil;
  const boosted = interact(g, 'human', 'board');
  assert.equal(boosted.ok, true);
  assert.equal(boosted.quality, true);
  assert.equal(g.stations.board.quality, true);
  assert.ok(g.stations.board.busyUntil < busyBefore);
  assert.equal(interact(g, 'human', 'board').ok, false);
  advance(g, CHOP_MS);
  assert.equal(g.stations.board.state, 'chopped');
  assert.equal(interact(g, 'human', 'plates').ok, true);
  assert.equal(interact(g, 'human', 'board').ok, true);
  assert.equal(g.human.quality, true);
  const served = interact(g, 'human', 'serve');
  assert.equal(served.ok, true);
  assert.ok(served.points >= 130);
});

test('staff profile changes AI preparation without changing the candidate contract', () => {
  const g = createGame({ level: 4, stock: 20, staffId: 'chef', hired: ['helper', 'chef'] });
  assert.deepEqual(g.hired, ['helper', 'chef']);
  g.ai.carrying = 'tomato';
  assert.equal(interact(g, 'ai', 'board').ok, true);
  assert.equal(g.stations.board.duration, Math.round(CHOP_MS * 0.55));
  const candidate = buildCandidates(g);
  assert.ok(!candidate.some((c) => c.id === 'fetch_plate'));
  assert.equal(
    candidate.some((c) => c.id === 'boost_board'),
    false,
  );
  assert.equal(observe(g).staff.id, 'chef');
  assert.deepEqual(observe(g).staff.capabilities, ['prep', 'cook']);
  assert.equal(observe(g).staff.decision_interval_ms, 900);
  g.level = 10;
  for (const [id, duration] of [
    ['pot', 9000],
    ['grill', 5250],
  ]) {
    g.ai.carrying = 'chopped';
    assert.equal(interact(g, 'ai', id).ok, true);
    assert.equal(g.stations[id].duration, duration);
  }
});

test('finite stock is consumed by pickup and restored only by returning the tomato', () => {
  const g = createGame({ level: 2, stock: 1 });
  assert.equal(STOCK_PRICE, 8);
  assert.equal(interact(g, 'human', 'crate').ok, true);
  assert.equal(g.stock, 0);
  assert.equal(interact(g, 'human', 'crate').ok, true);
  assert.equal(g.stock, 1);
  assert.equal(interact(g, 'human', 'crate').ok, true);
  assert.equal(g.stock, 0);
  assert.equal(discard(g, 'human'), true);
  assert.equal(g.stock, 0);
  assert.equal(interact(g, 'human', 'crate').ok, false);
  assert.equal(
    buildCandidates(g).some((candidate) => candidate.id === 'fetch_tomato'),
    false,
  );
});

test('staff capabilities gate candidate actions and direct stale execution', () => {
  const helper = createGame({ level: 3, stock: 2 });
  helper.ai.carrying = 'chopped';
  assert.equal(
    buildCandidates(helper).some((candidate) => candidate.id === 'collect'),
    false,
  );
  assert.equal(interact(helper, 'ai', 'board').ok, false);

  const chef = createGame({ level: 4, staffId: 'chef', hired: ['helper', 'chef'], stock: 2 });
  chef.ai.carrying = 'plate';
  chef.stations.board.state = 'chopped';
  assert.equal(
    buildCandidates(chef).some((candidate) => candidate.id === 'plate'),
    false,
  );
  assert.ok(buildCandidates(chef).some((candidate) => candidate.id === 'return_plate'));
  assert.equal(interact(chef, 'ai', 'board').ok, false);

  const runner = createGame({
    level: 4,
    stock: 20,
    staffId: 'runner',
    hired: ['helper', 'runner'],
  });
  assert.equal(
    buildCandidates(runner).some((candidate) => candidate.id === 'fetch_tomato'),
    false,
  );
  assert.ok(buildCandidates(runner).some((candidate) => candidate.id === 'wait'));
});

test('crew actors obey the level cap and reserve exclusive work independently', () => {
  const roster = ['helper', 'sous', 'runner', 'veteran'];
  for (const [level, cap] of [
    [7, 1],
    [8, 2],
    [12, 3],
    [16, 4],
  ]) {
    const g = createGame({ level, stock: 20, hired: roster, duty: roster });
    assert.deepEqual(g.duty, roster.slice(0, cap));
  }
  const g = createGame({ level: 20, stock: 20, hired: roster, duty: roster });
  assert.notEqual(actor(g, 'helper'), actor(g, 'sous'));
  actor(g, 'helper').intent = { id: 'chop', station: 'board' };
  actor(g, 'sous').carrying = 'tomato';
  assert.equal(isFeasible(g, { id: 'chop', station: 'board' }, 'sous'), false);
  assert.equal(interact(g, 'sous', 'board').ok, false);
  actor(g, 'helper').intent = null;
  assert.equal(interact(g, 'sous', 'board').ok, true);
  assert.equal(g.stations.board.by, 'sous');
});

test('crew reservations prevent duplicate tomato and plate pickups', () => {
  const g = createGame({ level: 10, stock: 8, duty: ['helper', 'sous'] });
  actor(g, 'helper').intent = { id: 'fetch_tomato', station: 'crate' };
  assert.equal(
    buildCandidates(g, 'sous').some((c) => c.id === 'fetch_tomato'),
    false,
  );
  actor(g, 'helper').intent = { id: 'fetch_plate', station: 'plates' };
  g.orders = [{ id: 99, recipe: 'soup', deadline: 10_000, duration: 10_000 }];
  g.stations.pot.state = 'ready';
  assert.equal(
    buildCandidates(g, 'sous').some((c) => c.id === 'fetch_plate'),
    false,
  );
  actor(g, 'helper').intent = null;
  actor(g, 'helper').carrying = 'plate';
  assert.equal(
    buildCandidates(g, 'sous').some((c) => c.id === 'fetch_plate'),
    false,
  );
});

test('equipment adds parallel stations only when purchased', () => {
  const locked = createGame({ level: 10, stock: 20 });
  assert.deepEqual(activeStationIds(locked), ['crate', 'board', 'pot', 'grill', 'plates', 'serve']);
  assert.equal(locked.stations.board2.state, 'idle');
  assert.equal(stationKind('board2'), 'board');

  const expanded = createGame({
    level: 10,
    stock: 20,
    equipment: {
      board: { count: 2, level: 1 },
      pot: { count: 2, level: 1 },
      grill: { count: 2, level: 1 },
    },
    hired: ['helper', 'sous'],
    duty: ['helper', 'sous'],
  });
  assert.deepEqual(activeStationIds(expanded), [
    'crate',
    'board',
    'board2',
    'pot',
    'pot2',
    'grill',
    'grill2',
    'plates',
    'serve',
  ]);
  actor(expanded, 'helper').carrying = 'tomato';
  actor(expanded, 'sous').carrying = 'tomato';
  assert.equal(interact(expanded, 'helper', 'board').ok, true);
  assert.equal(interact(expanded, 'sous', 'board2').ok, true);
  assert.equal(expanded.stations.board.by, 'helper');
  assert.equal(expanded.stations.board2.by, 'sous');
});

test('equipment levels shorten the matching station without changing recipes', () => {
  const g = createGame({
    level: 10,
    stock: 20,
    equipment: {
      board: { count: 1, level: 2 },
      pot: { count: 1, level: 2 },
      grill: { count: 1, level: 3 },
    },
  });
  g.human.carrying = 'tomato';
  assert.equal(interact(g, 'human', 'board').ok, true);
  assert.equal(g.stations.board.duration, Math.round(CHOP_MS * 0.92));
  g.stations.board.state = 'idle';
  g.human.carrying = 'chopped';
  assert.equal(interact(g, 'human', 'pot').ok, true);
  assert.equal(g.stations.pot.duration, Math.round(COOK_MS * 0.92));
  g.stations.pot.state = 'idle';
  g.human.carrying = 'chopped';
  assert.equal(interact(g, 'human', 'grill').ok, true);
  assert.equal(g.stations.grill.duration, Math.round(GRILL_MS * 0.84));
});

test('additional heat stations keep burn and boost boundaries independent', () => {
  const g = createGame({
    level: 20,
    stock: 20,
    equipment: {
      board: { count: 2, level: 2 },
      pot: { count: 2, level: 1 },
      grill: { count: 2, level: 1 },
    },
  });
  g.human.carrying = 'chopped';
  assert.equal(interact(g, 'human', 'pot2').ok, true);
  const pot = g.stations.pot2;
  advance(g, pot.duration);
  assert.equal(pot.state, 'ready');
  assert.equal(pot.burnAt, pot.busyUntil + burnGraceMs(g, 'pot2'));
  advance(g, burnGraceMs(g, 'pot2'));
  assert.equal(pot.state, 'burnt');
  assert.equal(interact(g, 'human', 'pot2').action, '焦げを片づけた');

  g.human.carrying = 'tomato';
  assert.equal(interact(g, 'human', 'board2').ok, true);
  advance(g, g.stations.board2.duration * 0.4);
  assert.ok(buildCandidates(g, 'human').some((candidate) => candidate.id === 'boost_board_board2'));
  assert.equal(interact(g, 'human', 'board2').quality, true);
});

test('equipment layout keeps positions valid across kitchen expansion', () => {
  const g = createGame({
    level: 20,
    stock: 20,
    equipment: {
      board: { count: 2, level: 1 },
      pot: { count: 2, level: 1 },
      grill: { count: 2, level: 1 },
      warmer: { count: 1, level: 2 },
      kitchen: { count: 1, level: 3 },
    },
  });
  assert.equal(kitchenBounds(g).maxX, 1435);
  assert.deepEqual(stationInfo(g, 'board'), {
    name: 'まな板',
    x: 390,
    y: 190,
    dx: 0,
    dy: -84,
  });
  assert.equal(layoutSlots(g).warmer.x, 680);
  assert.equal(layoutSlots(g).top_extra.x, 1390);

  const moved = resolveLayout(g, { board: 'top_extra' });
  assert.equal(moved.board, 'top_extra');
  assert.equal(stationInfo({ ...g, layout: moved }, 'board').x, 1390);
  assert.equal(resolveLayout(g, { board: 'top_extra', board2: 'top_extra' }), null);
  assert.equal(resolveLayout(g, { unknown: 'board' }), null);

  const level2 = createGame({
    level: 10,
    stock: 10,
    equipment: { kitchen: { count: 1, level: 2 } },
  });
  assert.equal(kitchenBounds(level2).maxX, 1305);
  assert.equal(layoutSlots(level2).top_extra, undefined);
});

test('expanded fixed slots keep every relocated countertop non-overlapping', () => {
  const g = createGame({
    level: 20,
    stock: 20,
    equipment: {
      board: { count: 2, level: 1 },
      pot: { count: 2, level: 1 },
      grill: { count: 2, level: 1 },
      warmer: { count: 1, level: 1 },
      kitchen: { count: 1, level: 3 },
    },
  });
  const slots = Object.entries(layoutSlots(g));
  const maxWidth = 2.56 * 65;
  const maxDepth = 1.5 * 65;
  for (let i = 0; i < slots.length; i++) {
    const [, a] = slots[i];
    const ax = a.x + a.dx;
    const ay = a.y + a.dy;
    for (let j = i + 1; j < slots.length; j++) {
      const [, b] = slots[j];
      const bx = b.x + b.dx;
      const by = b.y + b.dy;
      assert.ok(
        Math.abs(ax - bx) >= maxWidth || Math.abs(ay - by) >= maxDepth,
        `slot overlap: ${slots[i][0]} / ${slots[j][0]}`,
      );
    }
  }
  const layout = resolveLayout(g, { board: 'top_extra', board2: 'bottom_extra' });
  assert.equal(stationInfo({ ...g, layout }, 'board').x, 1390);
  assert.equal(stationInfo({ ...g, layout }, 'board2').x, 1390);
});

test('observations expose active station coordinates and the saved layout', () => {
  const g = createGame({ level: 5, stock: 8, layout: { board: 'board2' } });
  const body = observe(g);
  assert.equal(body.layout.board, 'board2');
  assert.deepEqual(body.kitchen_bounds, kitchenBounds(g));
  assert.equal(body.stations.board.active, true);
  assert.equal(body.stations.board.x, 620);
  assert.equal(body.stations.board2.active, false);
  assert.equal(body.stations.board2.x, undefined);
});

test('a moved station survives the next unlock without colliding with the new station', () => {
  const equipment = { kitchen: { count: 1, level: 3 } };
  const before = createGame({ level: 2, stock: 8, equipment, layout: { board: 'pot' } });
  assert.equal(before.layout.board, 'pot');
  assert.equal(before.layout.pot, undefined);

  const after = resolveLayout({ level: 5, equipment }, before.layout);
  assert.equal(after.board, 'pot');
  assert.notEqual(after.pot, after.board);
  assert.equal(new Set(Object.values(after)).size, Object.keys(after).length);
  assert.equal(stationInfo({ level: 5, equipment, layout: after }, 'board').x, 930);
});

test('payroll and role-specific rest advance once per shift and from Lv9', () => {
  const g = createGame({
    level: 25,
    stock: 20,
    hired: ['helper', 'chef', 'runner'],
    duty: ['helper', 'chef'],
    staffState: {
      helper: { worked: 3, rest: 0 },
      chef: { worked: 2, rest: 0 },
      runner: { worked: 0, rest: 1 },
    },
  });
  assert.equal(payroll(['helper', 'chef', 'helper']), 57);
  assert.equal(payroll([]), 0);
  const next = nextStaffState(g);
  assert.deepEqual(next.helper, { worked: 0, rest: 1 });
  assert.deepEqual(next.chef, { worked: 0, rest: 2 });
  assert.deepEqual(next.runner, { worked: 0, rest: 0 });
  assert.equal(staffAvailable(next, 'helper'), false);
  assert.equal(staffAvailable(next, 'runner'), true);
  const rested = nextStaffState({ ...g, duty: [], staffState: next });
  assert.deepEqual(rested.chef, { worked: 0, rest: 1 });
  assert.deepEqual(rested.helper, { worked: 0, rest: 0 });
  assert.deepEqual(nextStaffState({ ...g, duty: [] }).helper, { worked: 0, rest: 0 });
  assert.ok(
    Object.values(nextStaffState({ ...g, level: 8 })).every((s) => s.worked === 0 && s.rest === 0),
  );
});

test('the tutorial waits indefinitely and keeps the one dish reward', () => {
  const g = createGame({ cash: 180 });
  advance(g, 300_000);
  assert.equal(g.duration, Infinity);
  assert.equal(g.orders.length, 1);
  assert.equal(g.missed, 0);
  assert.deepEqual(g.duty, []);
  for (const station of ['crate', 'board', 'plates']) interact(g, 'human', station);
  advance(g, CHOP_MS);
  interact(g, 'human', 'board');
  interact(g, 'human', 'serve');
  assert.equal(g.served, 1);
  assert.equal(g.quota, 1);
  assert.equal(g.cash, 205);
  assert.equal(g.orders.length, 0);
});

test('menu prices are paid per dish independently of score bonuses', () => {
  const g = createGame({ level: 7, cash: 0, stock: 3 });
  for (const [recipe, price] of [
    ['dish', 25],
    ['soup', 35],
    ['roast', 45],
  ]) {
    const before = g.cash;
    g.human.carrying = recipe;
    g.orders = [{ recipe, deadline: 30000 }];
    assert.equal(interact(g, 'human', 'serve').ok, true);
    assert.equal(g.cash - before, price);
  }
});

test('heated stations burn after their grace period and can be cleaned', () => {
  assert.equal(COOK_MS, 12_000);
  assert.equal(GRILL_MS, 7000);
  for (const [id, duration, grace] of [
    ['pot', 12_000, POT_BURN_MS],
    ['grill', 7000, GRILL_BURN_MS],
  ]) {
    const g = createGame({ level: 20, stock: 2 });
    advance(g, 1000);
    g.human.carrying = 'chopped';
    assert.equal(interact(g, 'human', id).ok, true);
    const st = g.stations[id];
    assert.equal(st.duration, duration);
    assert.equal(st.startedAt, 1000);
    assert.equal(st.busyUntil, 1000 + duration);
    advance(g, duration - 1);
    assert.equal(st.state, 'cooking');
    advance(g, 1);
    assert.equal(st.state, 'ready');
    assert.equal(st.burnAt, st.busyUntil + grace);
    advance(g, grace - 1);
    assert.equal(st.state, 'ready');
    advance(g, 1);
    assert.equal(st.state, 'burnt');
    assert.equal(g.burned, 1);
    assert.equal(interact(g, 'human', id).action, '焦げを片づけた');
    assert.equal(st.state, 'idle');
    assert.equal(st.duration, 0);
    assert.equal(st.burnAt, 0);
    assert.equal(st.boosted, false);
    g.human.carrying = 'chopped';
    assert.equal(interact(g, 'human', id).ok, true);
    advance(g, duration / 4 - 1);
    assert.equal(interact(g, 'human', id).ok, false);
    advance(g, 1);
    const unboostedEnd = st.busyUntil;
    assert.equal(interact(g, 'human', id).quality, true);
    assert.ok(st.busyUntil < unboostedEnd);
    assert.equal(interact(g, 'human', id).ok, false);
    advance(g, st.busyUntil - g.time);
    assert.equal(st.state, 'ready');
    assert.equal(st.burnAt, st.busyUntil + grace);
  }
});

test('burnt cookware never strands a plate carrier', () => {
  const g = createGame({ level: 2, stock: 2 });
  g.ai.carrying = 'plate';
  g.stations.pot.state = 'burnt';
  const candidates = buildCandidates(g);
  assert.ok(candidates.some((c) => c.id === 'return_plate'));
  assert.equal(
    isFeasible(
      g,
      candidates.find((c) => c.id === 'return_plate'),
    ),
    true,
  );
});

test('blocked work still exposes a safe wait and hand recovery action', () => {
  const cases = [
    (g) => {
      g.ai.carrying = 'plate';
      g.stations.board.state = 'chopping';
    },
  ];

  for (const setup of cases) {
    const g = createGame({ level: 3, stock: 99 });
    setup(g);
    const cands = buildCandidates(g);
    assert.ok(cands.some((c) => c.id === 'wait'));
    assert.ok(cands.some((c) => c.id === 'return_plate'));
  }
});

test('blocked cooks can discard, clean burnt cookware and start cooking again', () => {
  for (const staffId of ['chef', 'sous']) {
    for (const station of ['pot', 'pot2', 'grill', 'grill2']) {
      const kind = stationKind(station);
      const recipe = kind === 'pot' ? 'soup' : 'roast';
      const g = createGame({
        level: 20,
        stock: 4,
        staffId,
        equipment: { [kind]: { count: 2 } },
      });
      g.orders = g.orders.map((o) => ({ ...o, recipe }));
      for (const id of activeStationIds(g).filter((id) => stationKind(id) === kind))
        g.stations[id].state = 'burnt';
      Object.assign(g.stations[station], { state: 'ready', burnAt: 1 });
      Object.assign(g.ai, { carrying: 'chopped', quality: true });
      advance(g, 1);
      assert.equal(g.stations[station].state, 'burnt');

      const recovery = rulePick(g, buildCandidates(g));
      assert.equal(recovery.id, 'discard', `${staffId}: ${station}`);
      assert.equal(isFeasible(g, recovery), true);
      const stock = g.stock;
      g.combo = 3;
      assert.equal(discard(g, staffId), true);
      assert.equal(g.ai.carrying, null);
      assert.equal(g.ai.quality, null);
      assert.equal(g.stock, stock);
      assert.equal(g.combo, 0);
      assert.equal(isFeasible(g, recovery), false);
      const clean = buildCandidates(g).find((c) => c.station === station);
      assert.equal(clean.baseId ?? clean.id, `clean_${kind}`);
      assert.equal(interact(g, staffId, clean.station).ok, true);
      assert.equal(g.stations[station].state, 'idle');
      g.ai.carrying = 'chopped';
      assert.equal(interact(g, staffId, station).ok, true);
      assert.equal(g.stations[station].state, 'cooking');
    }
  }
});

test('hand recovery respects usable stations, crew reservations and stale decisions', () => {
  const g = createGame({
    level: 20,
    stock: 4,
    duty: ['chef', 'sous'],
    equipment: { pot: { count: 2 } },
  });
  g.orders = g.orders.map((o) => ({ ...o, recipe: 'soup' }));
  g.ai.carrying = 'chopped';
  g.stations.pot.state = 'burnt';
  const cook = rulePick(g, buildCandidates(g));
  assert.equal(cook.station, 'pot2');
  assert.equal(cook.baseId, 'cook');
  assert.ok(!buildCandidates(g).some((c) => c.id === 'discard'));
  g.crew.sous.intent = { id: 'cook_pot2', station: 'pot2' };
  const recovery = rulePick(g, buildCandidates(g));
  assert.equal(recovery.id, 'discard');
  g.crew.sous.intent = null;
  assert.equal(isFeasible(g, recovery), false);
  assert.equal(g.ai.carrying, 'chopped');
  g.ai.carrying = 'tomato';
  g.crew.sous.intent = { id: 'chop', station: 'board' };
  assert.equal(rulePick(g, buildCandidates(g)).id, 'return_tomato');
  assert.ok(!buildCandidates(g).some((c) => c.id === 'discard'));
  g.time = g.duration;
  assert.equal(isFeasible(g, { id: 'discard', station: null }), false);
  assert.equal(discard(g, 'chef'), false);
});

test('soup cooks asynchronously and needs a plate before serving', () => {
  const g = createGame({ level: 5, stock: 2 });
  assert.equal(g.level, 5);
  interact(g, 'human', 'crate');
  interact(g, 'human', 'board');
  advance(g, CHOP_MS);
  interact(g, 'human', 'board');
  assert.equal(g.human.carrying, 'chopped');
  assert.equal(interact(g, 'human', 'pot').ok, true);
  assert.equal(g.stations.pot.state, 'cooking');
  interact(g, 'human', 'plates');
  assert.equal(interact(g, 'human', 'pot').ok, false);
  advance(g, COOK_MS);
  assert.equal(interact(g, 'human', 'pot').ok, true);
  assert.equal(g.human.carrying, 'soup');
  assert.ok(interact(g, 'human', 'serve').points >= 140);
  assert.equal(g.stations.pot.state, 'idle');
  assert.equal(g.served, 1);
  assert.equal(g.level, 5);
  assert.equal(g.duration, SHIFT_MS);
});

test('hands can recover, and chopped tomatoes can be plated directly', () => {
  const g = createGame({ level: 3, stock: 99 });
  for (const station of ['crate', 'plates']) {
    assert.equal(interact(g, 'human', station).ok, true);
    assert.equal(interact(g, 'human', station).ok, true);
    assert.equal(g.human.carrying, null);
  }
  g.human.carrying = 'chopped';
  assert.equal(interact(g, 'human', 'plates').ok, true);
  assert.equal(g.human.carrying, 'dish');
  assert.equal(discard(g, 'human'), true);
  assert.equal(g.human.carrying, null);
  g.ai.carrying = 'tomato';
  g.stations.board.state = 'chopped';
  assert.ok(buildCandidates(g).some((c) => c.id === 'return_tomato'));
});

test('orders, combos, expiry and the end of a shift have consistent boundaries', () => {
  const g = createGame({ level: 3, stock: 99 });
  for (let i = 0; i < 3; i++) {
    g.human.carrying = g.orders[0].recipe;
    assert.ok(interact(g, 'human', 'serve').points > 0);
    assert.equal(g.combo, i + 1);
    assert.equal(g.orders.length, 2);
    advance(g, 1000);
  }
  advance(g, 12_001);
  assert.equal(g.combo, 0);
  const expiringId = g.orders[0].id;
  advance(g, g.orders[0].deadline - g.time);
  assert.equal(g.missed, 1);
  assert.ok(!g.orders.some((o) => o.id === expiringId));
  g.orders = g.orders.map((o) => ({ ...o, recipe: 'soup' }));
  g.human.carrying = 'dish';
  assert.equal(interact(g, 'human', 'serve').ok, false);
  assert.equal(g.human.carrying, 'dish');
  advance(g, g.duration - g.time);
  const score = g.score;
  g.human.carrying = 'soup';
  assert.equal(g.time, g.duration);
  assert.equal(interact(g, 'human', 'serve').ok, false);
  assert.equal(g.score, score);
});

test('the rule companion can finish soup and stale station targets are rejected', () => {
  const g = createGame({ level: 5, stock: 4, staffId: 'sous', hired: ['helper', 'sous'] });
  g.orders = g.orders.map((order) => ({ ...order, recipe: 'soup' }));
  for (let step = 0; step < 40 && g.served < 1; step++) {
    const candidate = rulePick(g, buildCandidates(g));
    assert.equal(isFeasible(g, candidate), true);
    if (candidate.station) assert.equal(interact(g, 'ai', candidate.station).ok, true);
    advance(g, 500);
  }
  assert.equal(g.served, 1);
  assert.ok(g.score >= 140);
  assert.equal(isFeasible(g, { id: 'fetch_tomato', station: 'serve' }), false);
  assert.equal(dash(g), true);
  assert.equal(dash(g), false);
  advance(g, 1800);
  assert.equal(dash(g), true);
});

test('station hints describe available interactions and unmet requirements', () => {
  const g = createGame({ level: 3, stock: 99 });

  assert.equal(actionHint(g, 'board'), 'トマトが必要です');
  g.human.carrying = 'tomato';
  assert.equal(actionHint(g, 'board'), 'トマトを切る');
  g.stations.board.state = 'chopping';
  assert.equal(actionHint(g, 'board'), 'カット中');
  g.stations.board.state = 'chopped';
  g.human.carrying = 'plate';
  assert.equal(actionHint(g, 'board'), 'サラダを盛る');

  g.human.carrying = 'chopped';
  assert.equal(actionHint(g, 'pot'), 'スープを煮る');
  g.stations.pot.state = 'cooking';
  assert.equal(actionHint(g, 'pot'), '煮込み中');
  g.stations.pot.state = 'ready';
  assert.equal(actionHint(g, 'pot'), '盛り付けにはお皿が必要です');
  g.human.carrying = 'plate';
  assert.equal(actionHint(g, 'pot'), 'スープを盛る');

  g.human.carrying = 'dish';
  assert.equal(actionHint(g, 'serve'), '配膳する');
  g.orders = g.orders.map((order) => ({ ...order, recipe: 'soup' }));
  assert.equal(actionHint(g, 'serve'), '注文なし');
});

test('boosts, burning and the one-time rush activate only at their level milestones', () => {
  for (const level of [5, 6]) {
    const g = createGame({ level, stock: 2 });
    interact(g, 'human', 'crate');
    interact(g, 'human', 'board');
    advance(g, CHOP_MS / 2);
    assert.equal(
      buildCandidates(g, 'human').some((c) => c.id === 'boost_board'),
      level === 6,
    );
    assert.equal(actionHint(g, 'board'), level === 6 ? '仕上げる' : 'カット中');
    assert.equal(interact(g, 'human', 'board').ok, level === 6);
  }
  for (const level of [5, 6]) {
    const g = createGame({ level, stock: 2 });
    g.human.carrying = 'chopped';
    interact(g, 'human', 'pot');
    advance(g, COOK_MS + POT_BURN_MS);
    assert.equal(g.stations.pot.state, level === 6 ? 'burnt' : 'ready');
    assert.equal(g.burned, level === 6 ? 1 : 0);
  }
  for (const level of [9, 10, 100]) {
    const g = createGame({ level, stock: 20 });
    advance(g, SHIFT_MS / 2 - 1);
    assert.equal(g.orders.length, 2);
    advance(g, 1);
    const expected = level >= 10 ? 3 : 2;
    assert.equal(g.orders.length, expected);
    if (level >= 10)
      assert.equal(
        g.orders.at(-1).deadline,
        g.time + Math.round((levelConfig(level).orderWindowMs * 4) / 3),
      );
    for (let second = 0; second < 40; second++) {
      advance(g, 1000);
      g.human.carrying = g.orders[0].recipe;
      interact(g, 'human', 'serve');
      assert.equal(g.orders.length, expected);
    }
  }
});

test('practice mode teaches one salad without timers or pressure', () => {
  const g = createGame({ practice: true });
  assert.equal(g.practice, true);
  assert.equal(g.orders.length, 1);
  assert.equal(g.orders[0].recipe, 'dish');
  assert.equal(g.orders[0].deadline, Infinity);

  assert.equal(interact(g, 'human', 'crate').ok, true);
  assert.equal(interact(g, 'human', 'board').ok, true);
  advance(g, CHOP_MS * 0.4);
  assert.equal(
    buildCandidates(g, 'human').some((c) => c.id === 'boost_board'),
    false,
  );
  assert.equal(interact(g, 'human', 'board').ok, false);
  advance(g, CHOP_MS);
  assert.equal(g.stations.board.state, 'chopped');
  assert.equal(interact(g, 'human', 'plates').ok, true);
  assert.equal(interact(g, 'human', 'board').ok, true);
  assert.equal(interact(g, 'human', 'serve').points, 100);
  assert.equal(g.orders.length, 0);
  assert.equal(g.combo, 0);

  advance(g, SHIFT_MS + 1000);
  assert.equal(g.time, SHIFT_MS + CHOP_MS * 1.4 + 1000);
  assert.equal(g.missed, 0);
  assert.equal(interact(g, 'human', 'crate').ok, true);
  assert.equal(discard(g, 'human'), true);
  assert.equal(observe(g).seconds_left, null);
});

test('every sidekick has a unique theme color and relative performance bars', () => {
  const colors = Object.values(STAFF).map((profile) => profile.color);
  assert.equal(new Set(colors).size, colors.length);
  assert.ok(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color)));
  for (const id of Object.keys(STAFF)) {
    const bars = staffPerformance(id);
    assert.deepEqual(
      bars.map((bar) => bar.key),
      ['speed', 'decision', 'chop', 'cook'],
    );
    assert.ok(
      bars.every((bar) => bar.ratio > 0 && bar.ratio <= 1),
      `${id} ratio`,
    );
  }
  const ratio = (id, key) => staffPerformance(id).find((bar) => bar.key === key).ratio;
  assert.equal(ratio('sprinter', 'speed'), 1);
  assert.equal(ratio('veteran', 'decision'), 1);
  assert.equal(ratio('chef', 'chop'), 1);
  assert.equal(ratio('chef', 'cook'), 1);
  assert.equal(ratio('chef', 'speed'), 0.15);
  assert.equal(staffPerformance('missing').length, 0);
});

test('a soup plate held by the player does not stop the helper from plating salad', () => {
  const g = createGame({ level: 4, stock: 10 });
  g.orders = ['soup', 'dish'].map((recipe, id) => ({
    id,
    recipe,
    deadline: 28_000,
    duration: 28_000,
  }));
  g.stations.pot.state = 'cooking';
  g.stations.board.state = 'chopped';
  g.human.carrying = 'plate';
  const candidates = buildCandidates(g, 'helper');
  assert.equal(rulePick(g, candidates, 'helper').id, 'fetch_plate');
  assert.equal(interact(g, 'helper', 'plates').ok, true);
  assert.equal(interact(g, 'helper', 'board').ok, true);
  assert.equal(interact(g, 'helper', 'serve').ok, true);
  assert.equal(g.human.carrying, 'plate');
  g.stations.pot.state = 'ready';
  assert.equal(
    buildCandidates(g, 'helper').some((c) => c.id === 'fetch_plate'),
    false,
  );
});
