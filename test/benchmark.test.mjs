import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCandidates, buildQuestions, createGame, interact, SHIFT_MS } from '../src/model.js';
import { useKitchen, startBenchmark, benchmarkAction, tick, nextShift } from '../src/game.js';
import { runBenchmark, stopBenchmark, useBenchmark, latencyStats } from '../src/benchmark.js';

const writes = [];
const model = { id: 'jev', name: 'Jev' };
const answer = (choice) =>
  Response.json({ ok: true, result: { answers: { next_action: { choice } } } });

test.beforeEach(() => {
  writes.length = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: (...args) => writes.push(args),
    },
  });
  useKitchen.setState({ ready: true, phase: 'ready', menuOpen: false, benchmark: false });
  useBenchmark.setState({ running: false, results: [] });
});

test('player candidates complement the other actor and retain every human capability', () => {
  const g = createGame({ level: 2, stock: 10 });
  g.ai.carrying = 'tomato';
  assert.ok(!buildCandidates(g, 'human').some((c) => c.id === 'fetch_tomato'));
  g.ai.carrying = null;
  assert.ok(buildCandidates(g, 'human').some((c) => c.id === 'fetch_tomato'));
  g.human.carrying = 'tomato';
  assert.ok(!buildCandidates(g).some((c) => c.id === 'fetch_tomato'));
  g.orders[0].recipe = 'soup';
  g.human.carrying = 'chopped';
  const choices = buildCandidates(g, 'human');
  assert.ok(choices.some((c) => c.id === 'cook'));
  assert.match(buildQuestions(choices, 'human').next_action.instructions, /HUMAN player/);
});

test('benchmark actions use movement, reject stale work on arrival, and never save a campaign', () => {
  startBenchmark();
  const g = useKitchen.getState().game;
  assert.equal(g.cash, 120);
  assert.equal(useKitchen.getState().mode, 'rule');
  assert.ok(benchmarkAction(buildCandidates(g, 'human').find((c) => c.id === 'fetch_tomato')));
  tick(0.1);
  assert.equal(g.human.carrying, null);
  for (let i = 0; i < 20; i++) tick(0.1);
  assert.equal(g.human.carrying, 'tomato');
  assert.ok(benchmarkAction(buildCandidates(g, 'human').find((c) => c.id === 'chop')));
  g.stations.board.state = 'chopped';
  tick(0.1);
  assert.equal(g.human.intent, null);
  assert.equal(g.human.carrying, 'tomato');
  g.served = g.quota;
  g.time = SHIFT_MS;
  tick(0);
  assert.equal(nextShift(null), true);
  assert.equal(useKitchen.getState().game.level, 2);
  assert.equal(useKitchen.getState().game.staffId, 'helper');
  assert.equal(writes.length, 0);
});

test('a stale model reply is discarded and the request budget stops the run', async (t) => {
  let resolve;
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const run = runBenchmark({ model, maxRequests: 1 });
  const g = useKitchen.getState().game;
  interact(g, 'human', 'crate');
  resolve(answer('fetch_tomato'));
  await run;
  const result = useBenchmark.getState().results[0];
  assert.equal(result.status, 'budget');
  assert.equal(result.requests, 1);
  assert.equal(result.staleResponses, 1);
  assert.equal(g.human.carrying, 'tomato');
  assert.equal(useKitchen.getState().phase, 'paused');
  assert.equal(writes.length, 0);
});

test('API errors stop without fallback or repeat attempts; cancellation discards late answers', async (t) => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 502 }));
  await runBenchmark({ model, attempts: 3 });
  assert.equal(mocked.mock.callCount(), 1);
  assert.equal(useBenchmark.getState().results[0].status, 'error');
  assert.equal(useKitchen.getState().fallback, false);
  let resolve;
  mocked.mock.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const run = runBenchmark({ model });
  stopBenchmark('test stop');
  resolve(answer('fetch_tomato'));
  await run;
  assert.equal(useBenchmark.getState().results.at(-1).status, 'stopped');
  assert.equal(useKitchen.getState().game.human.intent, null);
  assert.equal(writes.length, 0);
});

test('complete shifts are recorded and repeated attempts reset the starting conditions', async (t) => {
  const starts = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    starts.push(body.state);
    const g = useKitchen.getState().game;
    g.time = SHIFT_MS;
    tick(0);
    return answer('wait');
  });
  await runBenchmark({ model, attempts: 2, maxLevel: 1 });
  assert.equal(starts.length, 2);
  assert.ok(
    starts.every((state) => state.level === 1 && state.cash === 120 && state.orders_served === 0),
  );
  const results = useBenchmark.getState().results;
  assert.equal(results.length, 2);
  assert.ok(
    results.every(
      (result) =>
        result.status === 'failed' && result.levels.length === 1 && result.clearedLevels === 0,
    ),
  );
  assert.equal(writes.length, 0);
  assert.deepEqual(latencyStats([100, 200, 300, 400]), { meanMs: 250, p95Ms: 400 });
  assert.deepEqual(latencyStats([]), { meanMs: null, p95Ms: null });
});
