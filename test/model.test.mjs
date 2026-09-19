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
  completeOnboarding,
  discard,
  dash,
  actionHint,
  ITEM_EMOJI,
  activeStationIds,
  kitchenBounds,
} from '../src/model.js';

test('the four-step pipeline produces one served dish', () => {
  const g = createGame();

  assert.equal(interact(g, 'ai', 'crate').ok, true);
  assert.equal(g.ai.carrying, 'tomato');

  assert.equal(interact(g, 'ai', 'board').ok, true);
  assert.equal(g.ai.carrying, null);
  assert.equal(g.stations.board.state, 'chopping');
  assert.equal(g.stations.board.by, 'ai');

  // In the timing window, an empty-handed cook can finish the board early.
  g.time += CHOP_MS / 2;
  advance(g);
  assert.equal(g.stations.board.state, 'chopping');
  assert.equal(interact(g, 'human', 'board').ok, true);

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
  const g = createGame();
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
  const g = createGame();
  g.ai.carrying = 'plate';
  g.stations.board.state = 'chopped';
  const cand = buildCandidates(g).find((c) => c.id === 'plate');
  assert.equal(isFeasible(g, cand), true);

  // The human finishes the dish first; the AI's answer is now wrong.
  g.stations.board.state = 'idle';
  assert.equal(isFeasible(g, cand), false);
});

test('the fixed-rule comparator does not crowd the human', () => {
  const g = createGame();
  g.human.station = 'crate';
  const picked = rulePick(g, buildCandidates(g));
  assert.notEqual(picked.id, 'fetch_tomato');

  g.human.station = null;
  const picked2 = rulePick(g, buildCandidates(g));
  assert.equal(picked2.id, 'fetch_tomato'); // its highest-priority useful move
});

test('unknown actions are never feasible', () => {
  const g = createGame();
  assert.equal(isFeasible(g, { id: 'fly_to_moon' }), false);
  assert.equal(isFeasible(g, null), false);
});

test('candidate instructions include the serving end of both recipes', () => {
  const instructions = buildQuestions(buildCandidates(createGame())).next_action.instructions;
  assert.match(instructions, /Salad: tomato → chop → plate → serve/);
  assert.match(instructions, /Soup: tomato → chop → collect → pot → plate → serve/);
  assert.match(instructions, /Grilled tomato: tomato → chop → collect → grill → plate → serve/);
  assert.equal(ITEM_EMOJI.chopped, '🍅');
});

test('each campaign level is a fixed 90-second kitchen contract', () => {
  const level1 = createGame();
  assert.equal(level1.level, 1);
  assert.equal(level1.quota, 6);
  assert.equal(level1.duration, SHIFT_MS);
  assert.equal(level1.stock, null);
  assert.deepEqual(activeStationIds(level1), ['crate', 'board', 'plates', 'serve']);
  assert.deepEqual(kitchenBounds(level1), { minX: 85, maxX: 775, minY: 175, maxY: 402 });
  assert.ok(level1.orders.every((o) => o.recipe === 'dish'));

  const level2 = createGame({ level: 2, stock: 8 });
  assert.equal(level2.quota, 8);
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
    level: 3,
    cash: 200,
    staffId: 'chef',
    hired: ['helper', 'chef'],
    stock: 10,
  });
  assert.equal(level3.quota, 10);
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
    [1, 2, 3, 10, 25, 50, 75, 100].map((level) => levelConfig(level).quota),
    [6, 8, 10, 11, 12, 13, 13, 14],
  );
  assert.deepEqual(
    [1, 2, 3, 10, 25, 50, 75, 100].map((level) => levelConfig(level).orderWindowMs),
    [36_000, 28_588, 26_533, 23_413, 22_235, 21_636, 21_358, 21_185],
  );
  assert.equal(levelConfig(0).level, 1);
  assert.equal(levelConfig(101).level, MAX_LEVEL);
  assert.equal(quotaForLevel(4), 10);
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
    assert.ok(config.quota >= previous.quota && config.quota <= 14);
    assert.ok(config.orderWindowMs <= previous.orderWindowMs && config.orderWindowMs >= 21_000);
    assert.ok(
      Math.abs(Object.values(config.recipeMix).reduce((sum, value) => sum + value, 0) - 1) < 1e-12,
    );
    const g = createGame({ level, stock: 99 });
    assert.equal(g.duration, SHIFT_MS);
    assert.deepEqual(g.orders, createGame({ level, stock: 99 }).orders);
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

test('human boost is a one-shot quality bonus and AI cannot farm it', () => {
  const g = createGame();
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
  const g = createGame({ staffId: 'chef', hired: ['helper', 'chef'] });
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
  g.level = 3;
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
  const helper = createGame({ level: 2, stock: 2 });
  helper.ai.carrying = 'chopped';
  assert.equal(
    buildCandidates(helper).some((candidate) => candidate.id === 'collect'),
    false,
  );
  assert.equal(interact(helper, 'ai', 'board').ok, false);

  const chef = createGame({ level: 2, staffId: 'chef', hired: ['helper', 'chef'], stock: 2 });
  chef.ai.carrying = 'plate';
  chef.stations.board.state = 'chopped';
  assert.equal(
    buildCandidates(chef).some((candidate) => candidate.id === 'plate'),
    false,
  );
  assert.ok(buildCandidates(chef).some((candidate) => candidate.id === 'return_plate'));
  assert.equal(interact(chef, 'ai', 'board').ok, false);

  const runner = createGame({ staffId: 'runner', hired: ['helper', 'runner'] });
  assert.equal(
    buildCandidates(runner).some((candidate) => candidate.id === 'fetch_tomato'),
    false,
  );
  assert.ok(buildCandidates(runner).some((candidate) => candidate.id === 'wait'));
});

test('completeOnboarding keeps tutorial progress and starts a clean campaign shift', () => {
  const g = createGame({ practice: true, cash: 200, staffId: 'sous', hired: ['helper', 'sous'] });
  interact(g, 'human', 'crate');
  interact(g, 'human', 'board');
  advance(g, CHOP_MS);
  interact(g, 'human', 'plates');
  interact(g, 'human', 'board');
  interact(g, 'human', 'serve');
  const identity = g;
  assert.equal(g.served, 1);
  assert.equal(g.score, 100);
  assert.equal(g.cash, 225);

  g.human.x = 520;
  g.human.y = 320;
  completeOnboarding(g);
  assert.equal(g, identity);
  assert.equal(g.practice, false);
  assert.equal(g.level, 1);
  assert.equal(g.duration, SHIFT_MS);
  assert.equal(g.quota, 6);
  assert.equal(g.time, 0);
  assert.equal(g.served, 1);
  assert.equal(g.score, 100);
  assert.equal(g.cash, 225);
  assert.deepEqual(g.hired, ['helper', 'sous']);
  assert.equal(g.stock, null);
  assert.equal(g.combo, 0);
  assert.equal(g.lastServeAt, -Infinity);
  assert.equal(g.orders.length, 2);
  assert.ok(g.orders.every((order) => order.recipe === 'dish'));
  assert.equal(g.stations.board.state, 'idle');
  assert.equal(g.human.carrying, null);
  assert.deepEqual([g.human.x, g.human.y], [520, 320]);
});

test('heated stations burn after their grace period and can be cleaned', () => {
  assert.equal(COOK_MS, 12_000);
  assert.equal(GRILL_MS, 7000);
  for (const [id, duration, grace] of [
    ['pot', 12_000, POT_BURN_MS],
    ['grill', 7000, GRILL_BURN_MS],
  ]) {
    const g = createGame({ level: 3, stock: 2 });
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
    const g = createGame();
    setup(g);
    const cands = buildCandidates(g);
    assert.ok(cands.some((c) => c.id === 'wait'));
    assert.ok(cands.some((c) => c.id === 'return_plate'));
  }
});

test('soup cooks asynchronously and needs a plate before serving', () => {
  const g = createGame({ level: 2, stock: 2 });
  assert.equal(g.level, 2);
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
  assert.equal(g.level, 2);
  assert.equal(g.duration, SHIFT_MS);
});

test('hands can recover, and chopped tomatoes can be plated directly', () => {
  const g = createGame();
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
  const g = createGame();
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
  const g = createGame({ level: 2, stock: 4, staffId: 'sous', hired: ['helper', 'sous'] });
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

test('action hints explain the next useful step for each station state', () => {
  const g = createGame();

  assert.equal(actionHint(g, 'board'), 'トマトを取ってこよう');
  g.human.carrying = 'tomato';
  assert.equal(actionHint(g, 'board'), 'トマトを切る');
  g.stations.board.state = 'chopping';
  assert.equal(actionHint(g, 'board'), '切り終わるまで待つ');
  g.stations.board.state = 'chopped';
  g.human.carrying = 'plate';
  assert.equal(actionHint(g, 'board'), 'サラダを盛る');

  g.human.carrying = 'chopped';
  assert.equal(actionHint(g, 'pot'), 'スープを煮る');
  g.stations.pot.state = 'cooking';
  assert.equal(actionHint(g, 'pot'), '煮込み中、別の仕事へ');
  g.stations.pot.state = 'ready';
  assert.equal(actionHint(g, 'pot'), 'お皿を持ってくる');
  g.human.carrying = 'plate';
  assert.equal(actionHint(g, 'pot'), 'スープを盛る');

  g.human.carrying = 'dish';
  assert.equal(actionHint(g, 'serve'), '配膳する');
  g.orders = g.orders.map((order) => ({ ...order, recipe: 'soup' }));
  assert.equal(actionHint(g, 'serve'), 'この料理の注文を待つ');
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
