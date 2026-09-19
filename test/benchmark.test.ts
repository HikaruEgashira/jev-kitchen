import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCandidates,
  buildQuestions,
  createGame,
  interact,
  SHIFT_MS,
  STATIONS,
  SPEED,
  movePlayer,
} from '../src/model.ts';
import {
  useKitchen,
  startBenchmark,
  benchmarkAction,
  tick,
  nextShift,
  setAutoMode,
  setMenuOpen,
  togglePause,
  resetGame,
  goTo,
  humanInteract,
  clearHands,
  humanDash,
  CHECKPOINT_KEY,
} from '../src/game.ts';
import { STAFF } from '../src/staff.ts';
import {
  runBenchmark,
  installAutoMode,
  stopBenchmark,
  pauseBenchmark,
  pauseBenchmarkWhenAway,
  resumeBenchmark,
  useBenchmark,
  latencyStats,
  benchRequest,
  preparationCandidates,
  kitchenHasWork,
  playingCandidates,
} from '../src/benchmark.ts';
import { preparation, purchase } from '../src/ui.ts';
import { runTicket } from '../src/api-client.ts';
import type {
  BenchDecision,
  DecisionContext,
  ItemId,
  StationState,
  StoreState,
} from '../src/types.ts';

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];
type TestDecision = Omit<BenchDecision, 'label'> & { label?: string };

// Billed requests carry a run ticket; prime the client cache so the mocked
// fetch in each test only sees decision calls.
const sessionFetch = globalThis.fetch;
globalThis.fetch = (url, options) =>
  String(url).endsWith('/api/session')
    ? Promise.resolve(
        Response.json({
          ok: true,
          mode: 'bench',
          seed: 2,
          expiresAt: Date.now() + 3_600_000,
          ticket: 'test-ticket',
        }),
      )
    : sessionFetch(url, options);
await runTicket('bench');
await runTicket('play');
globalThis.fetch = sessionFetch;

const writes: string[][] = [];
const model = { id: 'jev', name: 'Jev' };
const answer = (choice: string) =>
  Response.json({ ok: true, result: { answers: { next_action: { choice, confidence: 0.9 } } } });

test.beforeEach(() => {
  writes.length = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: (...args: string[]) => writes.push(args),
    },
  });
  useKitchen.setState({
    ready: true,
    phase: 'ready',
    menuOpen: false,
    benchmark: false,
    autoMode: false,
  });
  useBenchmark.setState({ running: false, results: [] });
});

test('player candidates retain legal actions without partner or recipe heuristics', () => {
  const g = createGame({ level: 5, stock: 10, duty: ['helper'] });
  g.crew.helper.carrying = 'tomato';
  assert.ok(buildCandidates(g, 'human').some((c) => c.id === 'fetch_tomato'));
  g.crew.helper.carrying = null;
  assert.ok(buildCandidates(g, 'human').some((c) => c.id === 'fetch_tomato'));
  g.human.carrying = 'tomato';
  assert.ok(!buildCandidates(g).some((c) => c.id === 'fetch_tomato'));
  g.orders[0].recipe = 'soup';
  g.human.carrying = 'chopped';
  const choices = buildCandidates(g, 'human');
  assert.ok(choices.some((c) => c.id === 'cook'));
  assert.ok(choices.some((c) => c.id === 'assemble'));
  assert.ok(choices.some((c) => c.id === 'discard'));
  assert.ok(choices.some((c) => c.id === 'dash_cook'));
  assert.ok(choices.some((c) => c.id === 'move_left'));
  assert.ok(choices.some((c) => c.id === 'visit_pot'));
  assert.match(buildQuestions(choices, 'human').next_action.instructions, /HUMAN player/);
});

test('work and navigation pages expose every legal human control', () => {
  const g = createGame({ level: 10, stock: 12 });
  for (const item of [null, 'tomato', 'chopped', 'plate', 'dish'] as (ItemId | null)[]) {
    g.human.carrying = item;
    const work = playingCandidates(g);
    const movement = playingCandidates(g, true);
    const reachable = new Set([...work, ...movement].map((c) => c.id));
    for (const action of buildCandidates(g, 'human')) assert.ok(reachable.has(action.id));
    assert.ok(work.some((c) => c.id === 'navigate'));
    assert.ok(movement.some((c) => c.id === 'back_to_work'));
    assert.ok(!work.some((c) => /^(dash_)?(visit_|move_)/.test(c.id)));
  }
});

test('player context describes food and hand state without prescribing an action', () => {
  const g = createGame({ level: 7, stock: 12, hired: ['chef'], duty: ['chef'] });
  g.orders = [{ id: 0, recipe: 'soup', deadline: 30000, duration: 30000 }];
  const instruction = () =>
    benchRequest(
      { ...useKitchen.getState(), game: g },
      { preparing: false, plan: preparation(g), candidates: playingCandidates(g) },
    ).state.situation;
  assert.match(instruction(), /No food is ready to plate/);
  g.stations.pot.state = 'ready';
  assert.match(instruction(), /Ordered food is ready/);
  g.human.carrying = 'plate';
  assert.match(instruction(), /Held item: plate/);
  g.stations.pot.state = 'cooking';
  assert.match(instruction(), /Ordered food is cooking/);
  g.stations.pot.state = 'idle';
  assert.match(instruction(), /No ordered food is ready or cooking/);
  g.human.carrying = 'dish';
  assert.match(instruction(), /has no current order and cannot be served/);
  assert.ok(buildCandidates(g, 'human').some((c) => c.id === 'discard'));
  assert.doesNotMatch(instruction(), /Prefer|Avoid|Discard it now|Choose plate|Keep your plate/);
});

test('playing context keeps active station facts without duplicated UI and campaign data', () => {
  startBenchmark();
  const g = useKitchen.getState().game;
  g.level = 5;
  g.practice = false;
  g.orders = [{ id: 0, recipe: 'soup', deadline: g.time + 30_000, duration: 30_000 }];
  g.human.x = STATIONS.pot.x;
  g.human.y = STATIONS.pot.y;
  const { state } = benchRequest(useKitchen.getState(), {
    preparing: false,
    plan: preparation(g),
    candidates: buildCandidates(g, 'human'),
  });
  const context = state as DecisionContext;
  assert.equal((context.stations!.pot as StationState).state, 'idle');
  assert.equal(context.human!.x, STATIONS.pot.x);
  assert.equal(context.orders![0].recipe, 'soup');
  assert.equal(context.stations!.pot2, undefined);
  assert.equal(context.screen, undefined);
  assert.equal(context.equipment, undefined);
  assert.equal(context.actor, undefined);
});

test('benchmark actions use movement, reject stale work on arrival, and never save a campaign', () => {
  startBenchmark();
  const g = useKitchen.getState().game;
  assert.equal(g.cash, 180);
  assert.equal(useKitchen.getState().mode, 'rule');
  assert.ok(benchmarkAction(buildCandidates(g, 'human').find((c) => c.id === 'fetch_tomato')!));
  tick(0.1);
  assert.equal(g.human.carrying, null);
  for (let i = 0; i < 20; i++) tick(0.1);
  assert.equal(g.human.carrying, 'tomato');
  assert.ok(benchmarkAction(buildCandidates(g, 'human').find((c) => c.id === 'chop')!));
  g.stations.board.state = 'chopped';
  tick(0.1);
  assert.equal(g.human.intent, null);
  assert.equal(g.human.carrying, 'tomato');
  g.served = g.quota;
  g.time = SHIFT_MS;
  tick(0);
  assert.equal(nextShift(null), true);
  assert.equal(useKitchen.getState().game.level, 2);
  assert.deepEqual(useKitchen.getState().game.duty, ['veteran']);
  assert.equal(writes.length, 0);
});

test('a stale model reply is discarded and the request budget stops the run', async (t) => {
  let resolve!: (value: Response) => void;
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise<Response>((done) => {
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
  assert.equal(result.conditions.frequency, 5);
  assert.equal(result.requests, 1);
  assert.equal(result.staleResponses, 1);
  assert.equal(g.human.carrying, 'tomato');
  assert.equal(useKitchen.getState().phase, 'paused');
  assert.equal(writes.length, 0);
});

test('API errors stop without fallback; cancellation discards late answers', async (t) => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 502 }));
  await runBenchmark({ model });
  assert.equal(mocked.mock.callCount(), 1);
  assert.equal(useBenchmark.getState().results[0].status, 'error');
  assert.equal(useKitchen.getState().fallback, false);
  let resolve!: (value: Response) => void;
  mocked.mock.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const run = runBenchmark({ model });
  stopBenchmark('test stop');
  resolve(answer('fetch_tomato'));
  await run;
  assert.equal(useBenchmark.getState().results.at(-1)!.status, 'stopped');
  assert.equal(useKitchen.getState().game.human.intent, null);
  assert.equal(writes.length, 0);
});

test('complete shifts are recorded and repeated attempts reset the starting conditions', async (t) => {
  const starts: DecisionContext[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: FetchInput, options?: FetchInit) => {
    const body = JSON.parse(String(options?.body));
    starts.push(body.state);
    const g = useKitchen.getState().game;
    useKitchen.setState({ game: createGame({ level: 2, cash: g.cash, stock: 10 }) });
    useKitchen.getState().game.time = SHIFT_MS;
    tick(0);
    return answer('wait');
  });
  await runBenchmark({ model });
  await runBenchmark({ model });
  assert.equal(starts.length, 2);
  assert.ok(
    starts.every((state) => state.level === 1 && state.stock === null && state.orders_served === 0),
  );
  assert.ok(starts.every((state) => state.controlled_actor === 'human'));
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

test('dash, directional movement, interruption and boosts use the human mechanics', () => {
  useKitchen.setState({ movementMode: 'grid' });
  startBenchmark();
  const g = useKitchen.getState().game;
  g.level = 15;
  g.practice = false;
  g.stock = 1;
  const act = (id: string) =>
    benchmarkAction(buildCandidates(g, 'human').find((c) => c.id === id)!);
  const initialX = g.human.x;
  assert.ok(act('dash_move_right'));
  tick(0.1);
  assert.ok(g.human.x > initialX + SPEED * 0.1);
  assert.equal(act('dash'), false);
  assert.ok(act('wait'));
  const stoppedX = g.human.x;
  tick(0.1);
  assert.equal(g.human.x, stoppedX);
  assert.ok(act('move_up_left'));
  const expected = structuredClone(g);
  movePlayer(expected, -1, -1, SPEED * 0.1);
  tick(0.1);
  assert.equal(g.human.x, expected.human.x);
  assert.equal(g.human.y, expected.human.y);
  assert.equal(useKitchen.getState().movementMode, 'grid');
  g.human.x = STATIONS.board.x;
  g.human.y = STATIONS.board.y;
  g.human.carrying = 'tomato';
  interact(g, 'human', 'board');
  tick(0.5);
  assert.ok(act('interact'));
  assert.equal(g.stations.board.boosted, true);
  assert.equal(writes.length, 0);
});

test('station taps perform the same arrival work as human clicks, without automatic boosts', () => {
  startBenchmark();
  const g = useKitchen.getState().game;
  const tap = (id: string) =>
    benchmarkAction(buildCandidates(g, 'human').find((c) => c.id === `visit_${id}`)!);
  const arrive = () => {
    for (let i = 0; i < 60 && g.human.intent; i++) tick(0.05);
  };
  assert.equal(tap('crate'), true);
  arrive();
  assert.equal(g.human.carrying, 'tomato');
  tap('board');
  arrive();
  assert.equal(g.stations.board.state, 'chopping');
  assert.equal(g.human.carrying, null);
  g.level = 6;
  g.practice = false;
  g.human.x = STATIONS.board.x + 110;
  g.human.y = STATIONS.board.y;
  tap('board');
  arrive();
  assert.equal(g.stations.board.boosted, false);
  tap('board');
  arrive();
  assert.equal(g.stations.board.boosted, true);
  g.human.carrying = 'dish';
  tap('serve');
  arrive();
  assert.equal(g.served, 1);
  assert.equal(g.human.carrying, null);
});

test('frequency spaces calls and the model hires, buys stock and assigns the next partner', async (t) => {
  const calls: number[] = [];
  const preparationCash = STAFF.chef.cost + 320;
  const choices = ['wait', 'hire_chef', 'crew_chef', 'stock_9', 'open_shift'];
  t.mock.method(globalThis, 'fetch', async (_url: FetchInput, options?: FetchInit) => {
    calls.push(performance.now());
    const body = JSON.parse(String(options?.body));
    const choice = choices[calls.length - 1];
    assert.ok(choice in body.questions.next_action.criteria);
    if (calls.length === 1) {
      const g = createGame({ level: 3, stock: 0 });
      useKitchen.setState({ game: g });
      g.cash = preparationCash;
      g.served = g.quota;
      g.time = SHIFT_MS;
      tick(0);
      useKitchen.setState({ applicants: ['chef'] });
    } else {
      assert.equal(body.state.phase, 'preparation');
      if (calls.length <= 3) assert.equal(body.state.preparation.applicants[0].id, 'chef');
      if (calls.length === 2) assert.deepEqual(body.state.preparation.duty, ['helper']);
      assert.equal(body.state.screen, undefined);
      assert.ok(body.state.preparation.cash_remaining >= 0);
    }
    return answer(choice);
  });
  await runBenchmark({ model, frequency: 10, maxRequests: 5 });
  const g = useKitchen.getState().game;
  assert.equal(g.level, 4);
  assert.equal(g.cash, 203);
  assert.equal(g.stock, 9);
  assert.deepEqual(g.duty, ['chef']);
  assert.ok(g.hired.includes('chef'));
  const result = useBenchmark.getState().results[0];
  assert.equal(result.status, 'budget');
  assert.equal(result.clearedLevels, 1);
  assert.deepEqual(
    useBenchmark.getState().splits.map(({ level, cash, score }) => ({ level, cash, score })),
    [{ level: 3, cash: preparationCash, score: 0 }],
  );
  assert.equal(result.requests, 5);
  assert.equal(result.conditions.frequency, 10);
  assert.ok(result.decisions.every((d) => d.confidence === 0.9 && d.candidateCount! > 1));
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i - 1] >= 100);
  assert.equal(writes.length, 0);
});

test('the model can buy equipment and vitamins before opening the shift', async (t) => {
  const choices = [
    'wait',
    'skip_hiring',
    'crew_helper',
    'confirm_stock',
    'equipment_add_board',
    'vitamin_move_human',
    'open_shift',
  ];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: FetchInput, options?: FetchInit) => {
    const body = JSON.parse(String(options?.body));
    const choice = choices[calls++];
    assert.ok(choice in body.questions.next_action.criteria, `${choice} not offered`);
    if (calls === 1) {
      const g = createGame({ level: 3, stock: 0 });
      useKitchen.setState({ game: g });
      g.cash = 2000;
      g.served = g.quota;
      g.time = SHIFT_MS;
      tick(0);
      useKitchen.setState({ applicants: ['chef'] });
    }
    return answer(choice);
  });
  await runBenchmark({ model, frequency: 10, maxRequests: 7 });
  const g = useKitchen.getState().game;
  assert.equal(g.level, 4);
  assert.equal(g.equipment.board.count, 2);
  assert.equal(g.training.human.move, 1);
});

test('invalid call limits and frequencies are rejected before a request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('unexpected call');
  });
  for (const frequency of [0, -1, 0.01, 11, NaN, Infinity, '1'] as (number | string)[])
    await assert.rejects(runBenchmark({ model, frequency: frequency as number }));
  for (const maxRequests of [0, -1, 1.5, 10001, NaN])
    await assert.rejects(runBenchmark({ model, maxRequests }));
  assert.equal(fetch.mock.callCount(), 0);
});

test('bench observes the player and can deploy, rotate and hire a full crew', () => {
  const g = createGame({
    level: 15,
    cash: 2000,
    stock: 20,
    hired: ['helper', 'runner', 'chef', 'sous'],
    duty: ['helper', 'runner', 'chef'],
  });
  g.staffState.runner.worked = 1;
  g.human.carrying = 'chopped';
  g.crew.helper.carrying = 'plate';
  const state = { ...useKitchen.getState(), game: g, applicants: ['prep'] };
  const plan = preparation(g);
  const observation = benchRequest(state, {
    preparing: true,
    plan: { ...plan, stage: 'staffing' },
    candidates: preparationCandidates(state, plan),
  }).state as DecisionContext;
  assert.equal(
    observation.actor,
    undefined,
    'preparation does not mix in the previous shift actor',
  );
  const playing = benchRequest(state, {
    preparing: false,
    plan,
    candidates: buildCandidates(g, 'human'),
  }).state as DecisionContext;
  assert.equal(playing.human!.carrying, 'chopped');
  assert.equal(playing.staff, undefined);
  assert.equal(observation.preparation!.roster!.find((s) => s.id === 'runner')!.rest, 1);
  assert.equal(observation.preparation!.next_level!.staffSlots, 4);
  assert.ok(observation.preparation!.next_level!.recipeMix.soup > 0);
  plan.selected = 'prep';
  for (const id of ['sous', 'prep']) {
    const option = preparationCandidates(state, plan).find((c) => c.id === `assign_${id}`)!;
    assert.ok(option, `can assign ${id}`);
    plan.duty = option.duty;
  }
  assert.deepEqual(plan.duty, ['helper', 'chef', 'sous', 'prep']);
  assert.equal(purchase(g, plan).error, '');
  assert.ok(!preparationCandidates(state, plan).some((c) => c.id === 'assign_runner'));
  const rest = preparationCandidates(state, plan).find((c) => c.id === 'rest_chef')!;
  assert.deepEqual(rest.duty, ['helper', 'sous', 'prep']);
  assert.equal(new Set(rest.duty!).size, 3);
  plan.stage = 'staffing';
  const crews = preparationCandidates(state, plan);
  assert.ok(crews.some((c) => c.duty!.join() === 'helper,chef,sous,prep'));
  assert.ok(crews.some((c) => c.duty!.join() === 'chef'));
  assert.ok(crews.some((c) => c.duty!.length === 0));
  for (const option of crews) {
    assert.ok(option.duty!.length <= 4);
    assert.ok(!option.duty!.includes('runner'), 'forced rest is never selectable');
    assert.equal(purchase(g, { ...plan, duty: option.duty }).error, '');
  }
});

test('empty stock sleeps only after every in-flight ingredient is finished', () => {
  const g = createGame({ level: 10, stock: 0 });
  g.human.carrying = 'plate';
  assert.equal(kitchenHasWork(g), false);
  g.stations.pot.state = 'cooking';
  assert.equal(kitchenHasWork(g), true);
  g.stations.pot.state = 'burnt';
  assert.equal(kitchenHasWork(g), false);
  g.crew.helper.carrying = 'chopped';
  assert.equal(kitchenHasWork(g), true);
  assert.equal(kitchenHasWork(createGame()), true);
});

test('travel completes without redundant model calls and stale arrival still cancels', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return answer('fetch_tomato');
    useKitchen.getState().game.human.carrying = null;
    return answer('return_plate');
  });
  const run = runBenchmark({ model, frequency: 10, maxRequests: 2 });
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(calls, 1);
  const g = useKitchen.getState().game;
  assert.equal(g.human.intent!.id, 'fetch_tomato');
  // A changed hand makes the destination stale before arrival.
  g.human.carrying = 'plate';
  tick(0.05);
  assert.equal(g.human.intent, null);
  await run;
  assert.equal(calls, 2);
  assert.equal(g.human.carrying, null);
  assert.equal(useBenchmark.getState().results.at(-1)!.staleResponses, 1);
});

test('tab-hidden pausing follows the background mode', () => {
  useBenchmark.setState({ running: true });
  useKitchen.setState({ phase: 'playing', backgroundMode: true });
  pauseBenchmarkWhenAway();
  assert.equal(useKitchen.getState().phase, 'playing');
  useKitchen.setState({ backgroundMode: false });
  pauseBenchmarkWhenAway();
  assert.equal(useKitchen.getState().phase, 'paused');
});

test('pause and resume retain the campaign and call budget without applying a pending reply', async (t) => {
  let firstReply!: (value: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => {
    calls++;
    if (calls === 1)
      return new Promise<Response>((resolve) => {
        firstReply = resolve;
      });
    interact(useKitchen.getState().game, 'human', 'crate');
    return Promise.resolve(answer('fetch_tomato'));
  });
  const run = runBenchmark({ model, frequency: 10, maxRequests: 2 });
  const g = useKitchen.getState().game;
  tick(0.1);
  pauseBenchmark();
  const frozen = g.time;
  firstReply(answer('fetch_tomato'));
  await new Promise((resolve) => setTimeout(resolve, 160));
  tick(1);
  assert.equal(g.time, frozen);
  assert.equal(calls, 1);
  assert.equal(useBenchmark.getState().running, true);
  assert.equal(useKitchen.getState().phase, 'paused');
  assert.equal(g.human.intent, null);
  resumeBenchmark();
  assert.equal(useKitchen.getState().game, g);
  assert.equal(useKitchen.getState().phase, 'playing');
  await run;
  const result = useBenchmark.getState().results.at(-1)!;
  assert.equal(result.status, 'budget');
  assert.equal(result.requests, 2);
  assert.equal(result.errors, 0);
  assert.equal(result.staleResponses, 2);
  assert.equal(writes.length, 0);
});

test('benchmark E uses the same handoff and rejects a partner who moved away', () => {
  startBenchmark();
  const g = createGame({ level: 4, stock: 10 });
  useKitchen.setState({ game: g, tutorial: null });
  Object.assign(g.human, { x: 500, y: 300, carrying: 'chopped' });
  Object.assign(g.ai!, { x: 520, y: 300 });
  const choice = buildCandidates(g, 'human').find((c) => c.partner === g.staffId)!;
  g.ai!.x = 800;
  assert.equal(benchmarkAction(choice), false);
  g.ai!.x = 520;
  assert.equal(benchmarkAction(choice), true);
  assert.equal(g.ai!.carrying, 'chopped');
  assert.equal(g.human.carrying, null);
});

test('investment facts reflect the pending board without choosing an upgrade', () => {
  const g = createGame({
    level: 7,
    cash: 1500,
    stock: 20,
    hired: ['helper', 'chef'],
    duty: ['chef'],
    training: { human: { move: 5, cook: 5 } },
  });
  const s: StoreState = {
    ...useKitchen.getState(),
    game: g,
    phase: 'finished',
    cleared: true,
    applicants: [],
  };
  const plan = { ...preparation(g), duty: ['helper', 'chef'], stage: 'investment' };
  const instruction = () =>
    benchRequest(s, { preparing: true, plan, candidates: preparationCandidates(s, plan) }).state
      .situation;
  assert.match(instruction(), /A station serves one actor/);
  assert.match(
    preparationCandidates(s, plan).find((c) => c.id === 'equipment_add_board')!.label,
    /同時に2台/,
  );
  plan.equipmentPurchases = ['add_board'];
  const pending = preparationCandidates(s, plan);
  assert.ok(!pending.some((c) => c.id === 'equipment_add_board'));
  assert.deepEqual(
    pending.find((c) => c.id === 'equipment_cancel_add_board')!.equipmentPurchases,
    [],
  );
  assert.match(pending.find((c) => c.id === 'equipment_cancel_add_board')!.label, /同時に1台/);
  const request = benchRequest(s, { preparing: true, plan, candidates: pending });
  const requestState = request.state as DecisionContext;
  assert.equal(requestState.preparation!.equipment!.board.count, 2);
  assert.equal(requestState.equipment, undefined);
  assert.equal(requestState.preparation!.bill, undefined);
});

test('staffing describes available cooks while keeping every legal roster available', () => {
  const g = createGame({
    level: 15,
    cash: 1000,
    stock: 20,
    hired: ['chef', 'sous'],
    duty: ['chef'],
    staffState: { chef: { worked: 1, rest: 0 }, sous: { worked: 0, rest: 0 } },
  });
  const s = { ...useKitchen.getState(), game: g, applicants: [] };
  const plan = { ...preparation(g), stage: 'staffing' };
  const candidates = preparationCandidates(s, plan);
  assert.ok(candidates.some((c) => c.id === 'crew_chef_sous'));
  assert.match(candidates.find((c) => c.id === 'crew_chef')!.label, /連勤2\/3/);
  const request = benchRequest(s, { preparing: true, plan, candidates });
  assert.match(request.state.situation, /Available heat cooks: chef, sous/);
});

test('bounded action feedback flags unproductive cycles, not cooking waits or sales', () => {
  const g = createGame({ level: 7, stock: 20 });
  const state = { ...useKitchen.getState(), game: g };
  const actions = ['fetch_plate', 'return_plate', 'fetch_plate', 'return_plate'];
  const decisions: TestDecision[] = ['fetch_tomato', 'chop', ...actions].map((action) => ({
    level: g.level,
    phase: 'playing',
    action,
    applied: true,
    stock: g.stock,
    served: g.served,
  }));
  const request = () =>
    benchRequest(state, {
      preparing: false,
      plan: preparation(g),
      candidates: playingCandidates(g),
      decisions: [{ ...decisions[0], level: 6 }, ...decisions] as BenchDecision[],
    }).state;
  assert.equal(request().recent_actions.length, 6);
  assert.equal(request().human!.recent_actions, undefined);
  assert.match(request().loop_warning!, /repeat without using stock or serving food/);
  const cycle = decisions.slice(-4);
  cycle.forEach((d, i) => {
    d.action = i % 2 ? 'return_tomato' : 'fetch_tomato';
    d.stock = i % 2 ? 19 : 20;
  });
  assert.ok(request().loop_warning, 'returning stock is not forward progress');
  cycle.forEach((d, i) => {
    d.label = i % 2 ? 'トマトを戻す' : 'トマトを取る';
    if (i >= 2) {
      d.action = 'interact';
      d.label += '（E）';
    }
    if (i === 3) d.label = `ダッシュして${d.label}`;
  });
  assert.ok(request().loop_warning, 'E and dash aliases still form the same cycle');
  cycle.forEach((d) => {
    delete d.label;
  });
  cycle.forEach((d, i) => {
    d.stock = 20 - i;
  });
  assert.equal(request().loop_warning, undefined, 'consuming stock is progress');
  cycle.forEach((d) => {
    d.stock = g.stock;
  });
  g.served++;
  assert.equal(request().loop_warning, undefined);
  g.served--;
  decisions.at(-1)!.applied = false;
  assert.equal(request().loop_warning, undefined);
  for (const d of decisions) {
    d.action = 'wait';
    d.applied = true;
  }
  assert.equal(request().loop_warning, undefined);
});

test('repeated purchase reversals stop before consuming the whole call budget', async (t) => {
  const choices = [
    'wait',
    'skip_hiring',
    'crew_chef',
    'confirm_stock',
    'equipment_add_board',
    'equipment_cancel_add_board',
    'equipment_add_board',
    'equipment_cancel_add_board',
    'equipment_add_board',
  ];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: FetchInput, options?: FetchInit) => {
    const request = JSON.parse(String(options?.body));
    const choice = choices[calls++];
    assert.ok(Object.hasOwn(request.questions.next_action.criteria, choice));
    assert.ok(request.state.recent_actions.length <= 6);
    if (request.state.preparation?.stage === 'investment') {
      assert.equal(request.state.preparation.quantity, undefined);
      assert.equal(request.state.preparation.recommended_purchase, undefined);
      assert.ok(
        request.state.recent_actions.every((d: { action: string }) =>
          d.action.startsWith('equipment_'),
        ),
      );
    }
    if (calls === 7) {
      assert.match(request.state.loop_warning, /same purchase plan/);
      assert.deepEqual(
        request.state.recent_actions.slice(-2).map((d: { action: string }) => d.action),
        ['equipment_add_board', 'equipment_cancel_add_board'],
      );
    }
    if (calls < 7) assert.equal(request.state.loop_warning, undefined);
    if (calls === 1) {
      const g = createGame({
        level: 7,
        cash: 1000,
        stock: 20,
        hired: ['helper', 'chef'],
        duty: ['chef'],
      });
      g.served = g.quota;
      g.time = g.duration;
      useKitchen.setState({ game: g, phase: 'finished', cleared: true, applicants: ['prep'] });
    }
    return answer(choice);
  });
  await runBenchmark({ model, frequency: 10, maxRequests: 20 });
  const result = useBenchmark.getState().results.at(-1)!;
  assert.equal(result.status, 'error');
  assert.match(result.error!, /Preparation cycle/);
  assert.equal(result.requests, 8);
  assert.ok(result.decisions.every((d) => d.requestBytes! > 0 && d.confidence === 0.9));
  assert.equal(useKitchen.getState().game.cash, 1000);
  assert.equal(writes.length, 0);
});

test('investment exposes capacity and the expansion that unlocks another pot', () => {
  const g = createGame({ level: 26, cash: 2500, stock: 24 });
  g.equipment = { ...g.equipment, board: { count: 2, level: 2 } };
  const state = { ...useKitchen.getState(), game: g };
  const plan = { ...preparation(g), stage: 'investment', quantity: 0 };
  let candidates = preparationCandidates(state, plan);
  assert.ok(!candidates.some((c) => c.id === 'equipment_add_pot'));
  const expansion = candidates.find((c) => c.id === 'equipment_upgrade_kitchen')!;
  assert.match(expansion.label, /設備枠1→2/);
  plan.equipmentPurchases = expansion.equipmentPurchases;
  candidates = preparationCandidates(state, plan);
  assert.ok(candidates.some((c) => c.id === 'equipment_add_pot'));
  assert.deepEqual(
    (benchRequest(state, { preparing: true, plan, candidates }).state as DecisionContext)
      .preparation!.equipment_capacity,
    { used: 1, limit: 2 },
  );
});

async function until(predicate: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    assert.ok(
      performance.now() < deadline,
      JSON.stringify({
        phase: useKitchen.getState().phase,
        level: useKitchen.getState().game.level,
        hand: useKitchen.getState().game.human.carrying,
        action: useKitchen.getState().autoStatus,
        log: useBenchmark.getState().log.slice(-5),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('auto preserves the current game, pauses with the menu, and returns control without stale replies', async (t) => {
  const g = createGame({ level: 7, cash: 777, stock: 12, duty: [] });
  g.time = 1234;
  useKitchen.setState({ game: g, phase: 'playing', sound: true, mode: 'rule', tutorial: null });
  const replies: ((response: Response) => void)[] = [];
  t.mock.method(globalThis, 'fetch', (url: FetchInput, options?: FetchInit) => {
    assert.equal(url, '/api/decide');
    const input = JSON.parse(String(options?.body));
    assert.equal(input.state.controlled_actor, 'human');
    assert.deepEqual(
      input.questions,
      benchRequest(useKitchen.getState(), {
        preparing: false,
        plan: {},
        candidates: playingCandidates(g),
      }).questions,
    );
    return new Promise<Response>((resolve) => replies.push(resolve));
  });
  setAutoMode(true);
  const run = runBenchmark({ model, autoplay: true });
  await until(() => replies.length === 1);
  assert.equal(useKitchen.getState().game, g);
  assert.equal(g.time, 1234);
  assert.equal(g.cash, 777);
  assert.equal(useKitchen.getState().benchmark, false);
  assert.equal(useKitchen.getState().sound, true);
  assert.equal(useKitchen.getState().mode, 'rule');
  setMenuOpen(true);
  replies[0](answer('fetch_tomato'));
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(replies.length, 1);
  assert.equal(g.human.intent, null);
  tick(0.05);
  assert.equal(g.time, 1234);
  setMenuOpen(false);
  togglePause();
  await until(() => replies.length === 2);
  replies[1](answer('fetch_tomato'));
  await until(() => g.human.intent !== null);
  const intent = g.human.intent;
  goTo('plates');
  humanInteract();
  humanDash();
  clearHands();
  assert.equal(g.human.intent, intent, 'manual controls do not compete with Jev');
  assert.equal(g.human.dashUntil, 0);
  for (let i = 0; i < 200 && !g.human.carrying; i++) tick(0.05);
  assert.equal(g.human.carrying, 'tomato', 'normal ticks execute the shared player action');
  await until(() => replies.length === 3);
  setAutoMode(false);
  replies[2](answer('chop'));
  await run;
  assert.equal(g.human.intent, null);
  assert.equal(useKitchen.getState().phase, 'playing');
  assert.equal(useKitchen.getState().game, g);
  assert.equal(useBenchmark.getState().results.length, 0);
  clearHands();
  assert.equal(g.human.carrying, null, 'human control resumes immediately');
});

test('auto starts after closing diagnostics, clears practice, prepares the next shift and saves it', async (t) => {
  useKitchen.setState({ game: createGame(), menuOpen: true, mode: 'rule', sound: false });
  const actions = ['fetch_tomato', 'chop', 'fetch_plate', 'plate', 'serve'];
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: FetchInput, options?: FetchInit) => {
    assert.equal(url, '/api/decide', 'normal auto play never submits a ranked bench run');
    requests++;
    const criteria = JSON.parse(String(options?.body)).questions.next_action.criteria;
    const choice = actions.length
      ? Object.hasOwn(criteria, actions[0])
        ? actions.shift()
        : 'wait'
      : ['skip_hiring', 'crew_veteran', 'confirm_stock', 'open_shift'].find((id) =>
          Object.hasOwn(criteria, id),
        );
    assert.ok(choice && Object.hasOwn(criteria, choice), Object.keys(criteria).join());
    return answer(choice);
  });
  const cleanup = installAutoMode();
  const unsubscribe = useKitchen.subscribe((s) => {
    if (s.autoMode && s.game.level === 2) setAutoMode(false);
  });
  const timer = setInterval(() => tick(0.05), 1);
  t.after(() => {
    cleanup();
    unsubscribe();
    clearInterval(timer);
  });
  setAutoMode(true);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(requests, 0);
  setMenuOpen(false);
  await until(() => useKitchen.getState().game.level === 2 && !useBenchmark.getState().running);
  assert.equal(actions.length, 0);
  assert.equal(useKitchen.getState().benchmark, false);
  assert.equal(useKitchen.getState().autoMode, false);
  assert.equal(useKitchen.getState().tutorial, null);
  const saved = writes
    .filter(([key]) => key === CHECKPOINT_KEY)
    .map(([, value]) => JSON.parse(value));
  assert.ok(
    saved.some((record) => record.level === 2),
    'auto progress uses normal checkpoint saves',
  );
});

test('reset during an auto request cancels the controller and ignores its answer', async (t) => {
  useKitchen.setState({ game: createGame(), phase: 'playing', sound: false });
  let reply: ((response: Response) => void) | undefined;
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        reply = resolve;
      }),
  );
  setAutoMode(true);
  const run = runBenchmark({ model, autoplay: true });
  await until(() => reply !== undefined);
  resetGame();
  const reset = useKitchen.getState().game;
  reply!(answer('fetch_tomato'));
  await run;
  assert.equal(useKitchen.getState().game, reset);
  assert.equal(useKitchen.getState().phase, 'ready');
  assert.equal(useKitchen.getState().autoMode, false);
  assert.equal(reset.human.intent, null);
  assert.equal(useBenchmark.getState().running, false);
});
