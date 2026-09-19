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
  SHIFT_MS,
  discard,
  dash,
  actionHint,
  ITEM_EMOJI,
} from '../src/model.js';

test('the four-step pipeline produces one served dish', () => {
  const g = createGame();

  assert.equal(interact(g, 'ai', 'crate').ok, true);
  assert.equal(g.ai.carrying, 'tomato');

  assert.equal(interact(g, 'ai', 'board').ok, true);
  assert.equal(g.ai.carrying, null);
  assert.equal(g.stations.board.state, 'chopping');
  assert.equal(g.stations.board.by, 'ai');

  // Still chopping: the board must refuse a second cook.
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
  assert.match(instructions, /Soup: tomato → chop → collect → cook → plate → serve/);
  assert.equal(ITEM_EMOJI.chopped, '🍅');
});

// A single wait candidate is handled locally, without an invalid Jev request.
test('some reachable states leave exactly one feasible action', () => {
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
    assert.equal(cands.length, 1);
    assert.equal(cands[0].id, 'wait');
  }
});

test('soup cooks asynchronously and needs a plate before serving', () => {
  const g = createGame();
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
    assert.equal(g.orders.length, 3);
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
  advance(g, SHIFT_MS);
  const score = g.score;
  g.human.carrying = 'soup';
  assert.equal(g.time, SHIFT_MS);
  assert.equal(interact(g, 'human', 'serve').ok, false);
  assert.equal(g.score, score);
});

test('the rule companion can finish soup and stale station targets are rejected', () => {
  const g = createGame();
  g.orders[0].recipe = 'soup';
  for (let step = 0; step < 40 && !g.served; step++) {
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
  advance(g, CHOP_MS);
  assert.equal(g.stations.board.state, 'chopped');
  assert.equal(interact(g, 'human', 'plates').ok, true);
  assert.equal(interact(g, 'human', 'board').ok, true);
  assert.equal(interact(g, 'human', 'serve').points, 100);
  assert.equal(g.orders.length, 0);
  assert.equal(g.combo, 0);

  advance(g, SHIFT_MS + 1000);
  assert.equal(g.time, SHIFT_MS + CHOP_MS + 1000);
  assert.equal(g.missed, 0);
  assert.equal(interact(g, 'human', 'crate').ok, true);
  assert.equal(discard(g, 'human'), true);
  assert.equal(observe(g).seconds_left, null);
});
