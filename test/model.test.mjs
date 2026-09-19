import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGame,
  interact,
  advance,
  buildCandidates,
  isFeasible,
  rulePick,
  CHOP_MS,
} from '../public/model.js';

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

// Jev の Choice は 2..255 択。候補が1つになる盤面があるので、呼び出し側は
// 問い合わせずに実行する必要がある（game.js の maybeDecide）。
test('some reachable states leave exactly one feasible action', () => {
  const cases = [
    (g) => {
      g.ai.carrying = 'tomato';
      g.stations.board.state = 'chopped'; // 人間が先に盛り付けた
    },
    (g) => {
      g.ai.carrying = 'plate';
      g.stations.board.state = 'idle';
    },
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
