import assert from 'node:assert/strict';
import test from 'node:test';
import {
  useKitchen,
  startShift,
  setMode,
  setPolicy,
  togglePause,
  setMenuOpen,
  setMenuPage,
  setCameraMode,
  setMovementMode,
  toggleBackgroundMode,
  tick,
  installControls,
  graphicsLost,
  humanInteract,
  goTo,
  clearHands,
  nextShift,
  retryShift,
  CHECKPOINT_KEY,
} from '../src/game.js';
import {
  STATIONS,
  SHIFT_MS,
  MAX_LEVEL,
  quotaForLevel,
  recommendedStock,
  createGame,
} from '../src/model.js';
import { STAFF, nextStaffState } from '../src/staff.js';

const storage = new Map([['sidekick-onboarded-v1', '1']]);
const installTestStorage = () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  });
};

test.beforeEach(() => {
  storage.clear();
  storage.set('sidekick-onboarded-v1', '1');
  installTestStorage();
  storage.set(
    CHECKPOINT_KEY,
    JSON.stringify({
      version: 2,
      ...createGame({ level: 3, cash: 180, stock: 20 }),
      completed: false,
    }),
  );
  useKitchen.setState({
    ready: true,
    phase: 'ready',
    menuOpen: false,
    menuPage: null,
    backgroundMode: true,
    cameraMode: 'auto',
    movementMode: 'grid',
    tutorial: null,
  });
});

test('camera settings preserve the shift and do not resume a paused menu', () => {
  setCameraMode('follow');
  startShift();
  assert.equal(useKitchen.getState().cameraMode, 'follow');
  const game = useKitchen.getState().game;
  setMenuOpen(true);
  setCameraMode('overview');
  assert.equal(useKitchen.getState().cameraMode, 'overview');
  setCameraMode('invalid');
  assert.equal(useKitchen.getState().cameraMode, 'overview');
  tick(30);
  assert.equal(useKitchen.getState().game, game);
  assert.equal(game.time, 0);
  assert.equal(useKitchen.getState().phase, 'paused');
  setMenuOpen(false);
  assert.equal(useKitchen.getState().phase, 'paused');
  setCameraMode('auto');
  assert.equal(useKitchen.getState().cameraMode, 'auto');
});

test('reopening the menu starts at the first page', () => {
  setMenuOpen(true);
  setMenuPage('controls');
  assert.equal(useKitchen.getState().menuPage, 'controls');
  setMenuOpen(false);
  setMenuOpen(true);
  assert.equal(useKitchen.getState().menuPage, null);
  setMenuPage('diagnostics');
  assert.equal(useKitchen.getState().menuPage, 'diagnostics');
  setMenuPage('nonsense');
  assert.equal(useKitchen.getState().menuPage, 'diagnostics');
});

test('keyboard movement keeps equal speed in screen and grid modes', () => {
  assert.equal(useKitchen.getInitialState().movementMode, 'grid');
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const windowListeners = new Map();
  const fakeWindow = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener(type) {
      windowListeners.delete(type);
    },
  };
  const fakeDocument = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const target = { closest: () => null };
  const event = (key, repeat = false) => ({
    key,
    repeat,
    target,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault() {},
  });
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  try {
    setMode('rule');
    startShift();
    const cleanup = installControls();
    const g = useKitchen.getState().game;
    const move = (mode, keys) => {
      setMovementMode(mode);
      g.human.x = 600;
      g.human.y = 290;
      for (const key of keys) windowListeners.get('keydown')(event(key));
      tick(0.2);
      for (const key of keys) windowListeners.get('keyup')(event(key));
      return { x: g.human.x - 600, y: g.human.y - 290 };
    };
    const distance = ({ x, y }) => Math.hypot(x, y);
    const screenRight = move('screen', ['d']);
    const screenLeft = move('screen', ['a']);
    const screenUp = move('screen', ['w']);
    const screenDown = move('screen', ['s']);
    const screenDiagonal = move('screen', ['d', 's']);
    for (const displacement of [screenRight, screenLeft, screenUp, screenDown, screenDiagonal])
      assert.ok(Math.abs(distance(displacement) - 45) < 0.001);
    assert.ok(screenRight.y < 0);

    const gridRight = move('grid', ['d']);
    const gridDiagonal = move('grid', ['d', 's']);
    assert.ok(Math.abs(distance(gridRight) - 45) < 0.001);
    assert.ok(Math.abs(distance(gridDiagonal) - 45) < 0.001);
    assert.equal(gridRight.y, 0);
    assert.ok(gridDiagonal.x > 0 && gridDiagonal.y > 0);
    setMovementMode('invalid');
    assert.equal(useKitchen.getState().movementMode, 'grid');
    const phase = useKitchen.getState().phase;
    const time = g.time;
    setMovementMode('screen');
    assert.equal(useKitchen.getState().phase, phase);
    assert.equal(g.time, time);
    setMovementMode('grid');
    togglePause();
    startShift();
    assert.equal(useKitchen.getState().movementMode, 'grid');
    cleanup();
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    if (useKitchen.getState().phase === 'playing') togglePause();
  }
});

test('a 90-second shift clears only after its quota and offers three applicants', () => {
  startShift();
  const g = useKitchen.getState().game;
  g.served = g.quota;
  g.time = SHIFT_MS;
  tick(1);
  assert.equal(useKitchen.getState().phase, 'finished');
  assert.equal(useKitchen.getState().cleared, true);
  assert.equal(useKitchen.getState().applicants.length, 3);
  assert.equal(new Set(useKitchen.getState().applicants).size, 3);
  assert.ok(
    useKitchen
      .getState()
      .applicants.every((id) => id !== 'helper' && !Object.hasOwn(nextStaffState(g), id)),
  );
});

test('corrupt best-score storage is normalized to a finite non-negative integer', async () => {
  const originalWindow = globalThis.window;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([['sidekick-best-v2', '12.9']]);
  globalThis.window = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => values.get(key) ?? null },
  });
  try {
    const fractional = await import(`../src/game.js?best-score-fractional-${Date.now()}`);
    assert.equal(fractional.useKitchen.getState().best, 12);
    values.set('sidekick-best-v2', 'Infinity');
    const infinite = await import(`../src/game.js?best-score-infinite-${Date.now()}`);
    assert.equal(infinite.useKitchen.getState().best, 0);
    values.set('sidekick-best-v2', '-1');
    const negative = await import(`../src/game.js?best-score-negative-${Date.now()}`);
    assert.equal(negative.useKitchen.getState().best, 0);
  } finally {
    globalThis.window = originalWindow;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }
});

test('reset discards an in-flight AI answer, and pause freezes the shift', async () => {
  const originalFetch = globalThis.fetch;
  let resolve;
  globalThis.fetch = () =>
    new Promise((done) => {
      resolve = done;
    });
  try {
    useKitchen.setState({ celebration: 4 });
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.equal(useKitchen.getState().celebration, 0);
    setMode('jev');
    tick(0.05);
    assert.equal(typeof resolve, 'function');
    useKitchen.setState({ phase: 'ready' });
    startShift();
    resolve(
      Response.json({ ok: true, result: { answers: { next_action: { choice: 'fetch_tomato' } } } }),
    );
    await new Promise(setImmediate);
    assert.equal(useKitchen.getState().game.ai.intent, null);
    assert.equal(useKitchen.getState().hud.decisions, 0);
    togglePause();
    tick(0.05);
    assert.equal(useKitchen.getState().game.time, 0);
    togglePause();
    setMode('rule');
    tick(0.05);
    assert.equal(useKitchen.getState().game.time, 50);
  } finally {
    globalThis.fetch = originalFetch;
    togglePause();
  }
});

test('API failure falls back without a request storm and mode changes invalidate answers', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('offline');
  };
  try {
    useKitchen.setState({ phase: 'ready' });
    startShift();
    setMode('jev');
    tick(0.05);
    await new Promise(setImmediate);
    assert.equal(useKitchen.getState().fallback, true);
    for (let i = 0; i < 100; i++) tick(0.05);
    assert.equal(calls, 1);
    let resolve;
    globalThis.fetch = () =>
      new Promise((done) => {
        resolve = done;
      });
    useKitchen.setState({ phase: 'ready' });
    startShift();
    tick(0.05);
    setMode('rule');
    resolve(
      Response.json({ ok: true, result: { answers: { next_action: { choice: 'fetch_tomato' } } } }),
    );
    await new Promise(setImmediate);
    assert.equal(useKitchen.getState().game.ai.intent, null);
    assert.equal(useKitchen.getState().hud.decisions, 0);
  } finally {
    globalThis.fetch = originalFetch;
    togglePause();
  }
});

test('AI recovers from burnt cookware through tick in rule, Jev and offline modes', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const mode of ['rule', 'jev', 'offline']) {
      for (const station of ['pot', 'pot2', 'grill', 'grill2']) {
        startShift();
        setMode(mode === 'rule' ? 'rule' : 'jev');
        const kind = station.startsWith('pot') ? 'pot' : 'grill';
        const g = createGame({
          level: 20,
          stock: 4,
          staffId: 'sous',
          equipment: { [kind]: { count: 2 } },
        });
        useKitchen.setState({ game: g });
        g.orders = g.orders.map((o) => ({
          ...o,
          recipe: kind === 'pot' ? 'soup' : 'roast',
          deadline: 89_000,
        }));
        g.stations[kind].state = 'burnt';
        g.stations[`${kind}2`].state = 'burnt';
        Object.assign(g.stations[station], { state: 'ready', burnAt: 1 });
        g.ai.carrying = 'chopped';
        let calls = 0;
        globalThis.fetch = async (_url, request) => {
          calls++;
          const criteria = JSON.parse(request.body).questions.next_action.criteria;
          assert.ok(Object.hasOwn(criteria, 'discard'));
          if (mode === 'offline') throw new Error('offline');
          return Response.json({
            ok: true,
            result: { answers: { next_action: { choice: 'discard' } } },
          });
        };
        tick(0.05);
        await new Promise(setImmediate);
        assert.equal(g.ai.intent.id, 'discard', `${mode}: ${station}`);
        assert.equal(calls, mode === 'rule' ? 0 : 1);
        assert.equal(useKitchen.getState().fallback, mode === 'offline');
        tick(0.05);
        assert.equal(g.ai.carrying, null);
        setMode('rule');
        for (let i = 0; i < 900 && g.served === 0; i++) tick(0.05);
        assert.notEqual(g.stations[station].state, 'burnt', `${mode}: ${station}`);
        assert.equal(g.served, 1, `${mode}: ${station}`);
        togglePause();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (useKitchen.getState().phase === 'playing') togglePause();
  }
});

test('rapid policy typing debounces AI requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ ok: true, result: { answers: { next_action: { choice: 'wait' } } } });
  };
  try {
    startShift();
    setMode('jev');
    setPolicy('ス');
    setPolicy('スー');
    setPolicy('スープ');
    for (let i = 0; i < 8; i++) tick(0.05);
    await new Promise(setImmediate);
    assert.equal(calls, 0);
    tick(0.05);
    await new Promise(setImmediate);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (useKitchen.getState().phase === 'playing') togglePause();
  }
});

test('staff decision intervals apply without a hidden minimum or overlapping requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ ok: true, result: { answers: { next_action: { choice: 'wait' } } } });
    };
    for (const staffId of ['veteran', 'helper']) {
      startShift();
      useKitchen.setState({
        game: createGame({ level: 4, stock: 20, duty: [staffId], hired: ['helper', staffId] }),
      });
      setMode('jev');
      calls = 0;
      tick(0.01);
      await new Promise(setImmediate);
      const interval = STAFF[staffId].decisionMs;
      for (let elapsed = 10; elapsed < interval; elapsed += 10) tick(0.01);
      assert.equal(calls, 1);
      tick(0.02);
      await new Promise(setImmediate);
      assert.equal(calls, 2, staffId);
    }
    let resolve;
    calls = 0;
    globalThis.fetch = () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    };
    startShift();
    useKitchen.setState({
      game: createGame({ level: 4, stock: 20, duty: ['veteran'], hired: ['helper', 'veteran'] }),
    });
    setMode('jev');
    for (let index = 0; index < 300; index++) tick(0.01);
    assert.equal(calls, 1);
    resolve(
      Response.json({ ok: true, result: { answers: { next_action: { choice: 'fetch_tomato' } } } }),
    );
    await new Promise(setImmediate);
    for (let index = 0; index < 35; index++) tick(0.01);
    assert.equal(useKitchen.getState().game.ai.intent.id, 'fetch_tomato');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (useKitchen.getState().phase === 'playing') togglePause();
  }
});

test('invalid preparation purchases are atomic and carried stock reduces the default purchase', () => {
  startShift();
  const g = useKitchen.getState().game;
  g.level = 2;
  g.stock = 4;
  g.served = quotaForLevel(2);
  g.cash = 300;
  g.time = SHIFT_MS;
  tick(0);
  useKitchen.setState({ applicants: ['prep', 'chef', 'veteran'] });
  const before = JSON.stringify(g);
  for (const args of [
    [null, -1],
    [null, 0.5],
    [null, NaN],
    [null, Infinity],
    [null, 100],
    [null, 0],
    ['unknown', 8],
    ['constructor', 8],
    ['runner', 8],
    ['veteran', 8],
    [null, 8, 'veteran'],
  ]) {
    assert.equal(nextShift(...args), false);
    assert.equal(JSON.stringify(g), before);
    assert.equal(useKitchen.getState().phase, 'finished');
  }
  assert.equal(nextShift(), true);
  const next = useKitchen.getState().game;
  assert.equal(next.stock, quotaForLevel(3) + 6);
  assert.equal(next.cash, 300 - (quotaForLevel(3) + 6 - 4) * 8 - STAFF.veteran.wage);
});

test('opening checkpoints resume progress without farming and reject corrupt saves', async () => {
  storage.delete(CHECKPOINT_KEY);
  startShift();
  const g = useKitchen.getState().game;
  g.served = g.quota;
  g.cash = 400;
  g.time = SHIFT_MS;
  tick(0);
  assert.equal(nextShift(null, quotaForLevel(2) + 2), true);
  const opening = JSON.parse(storage.get(CHECKPOINT_KEY));
  const active = useKitchen.getState().game;
  active.cash += 100;
  active.stock--;
  useKitchen.setState({ phase: 'ready' });
  startShift();
  assert.equal(useKitchen.getState().game.cash, opening.cash);
  assert.equal(useKitchen.getState().game.stock, opening.stock);
  assert.equal(useKitchen.getState().game.level, 2);
  const reload = await import(`../src/game.js?checkpoint-${Date.now()}`);
  assert.equal(reload.useKitchen.getState().phase, 'ready');
  assert.equal(reload.useKitchen.getState().game.level, 2);
  for (const bad of [
    'not json',
    'null',
    '[]',
    JSON.stringify({ ...opening, level: MAX_LEVEL + 1 }),
    JSON.stringify({ ...opening, cash: -1 }),
    JSON.stringify({ ...opening, stock: 0 }),
    JSON.stringify({ ...opening, duty: ['unknown'] }),
    JSON.stringify({ ...opening, hired: ['helper', 'constructor'] }),
  ]) {
    storage.set(CHECKPOINT_KEY, bad);
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.equal(useKitchen.getState().game.level, 1);
    assert.equal(useKitchen.getState().game.cash, 180);
  }
});

test('cleared shifts transact one applicant and stock for the next level', () => {
  startShift();
  const g = useKitchen.getState().game;
  const cash = Math.max(...Object.values(STAFF).map((staff) => staff.cost)) + 1000;
  g.cash = cash;
  g.served = g.quota;
  g.time = SHIFT_MS;
  tick(1);
  const applicant = useKitchen.getState().applicants[0];
  assert.equal(nextShift(applicant), true);
  const next = useKitchen.getState().game;
  assert.equal(next.level, 4);
  assert.equal(next.duration, SHIFT_MS);
  assert.equal(next.stock, 20);
  assert.equal(next.staffId, 'helper');
  assert.deepEqual(next.duty, ['helper']);
  assert.ok(next.hired.includes(applicant));
  assert.equal(next.cash, cash - STAFF[applicant].cost - STAFF.helper.wage);
});

test('skipping keeps the active staff and failed shifts retry from their opening snapshot', () => {
  startShift();
  const g = useKitchen.getState().game;
  g.cash = 300;
  g.served = g.quota;
  g.time = SHIFT_MS;
  tick(1);
  assert.equal(nextShift(null, 8), true);
  assert.equal(useKitchen.getState().game.staffId, 'helper');
  assert.equal(useKitchen.getState().game.stock, 28);

  storage.set(
    CHECKPOINT_KEY,
    JSON.stringify({
      version: 2,
      ...createGame({ level: 3, cash: 180, stock: 20 }),
      completed: false,
    }),
  );
  useKitchen.setState({ phase: 'ready' });
  startShift();
  const failed = useKitchen.getState().game;
  failed.cash = 42;
  failed.time = SHIFT_MS;
  tick(1);
  assert.equal(useKitchen.getState().cleared, false);
  failed.cash = 0;
  assert.equal(retryShift(), true);
  assert.equal(useKitchen.getState().game.cash, 180);
  assert.equal(useKitchen.getState().game.level, 3);
});

test('level one hundred clear ends the campaign without another applicant screen', () => {
  startShift();
  const g = useKitchen.getState().game;
  g.level = MAX_LEVEL;
  g.quota = quotaForLevel(MAX_LEVEL);
  g.served = g.quota;
  g.time = SHIFT_MS;
  tick(1);
  assert.equal(useKitchen.getState().cleared, true);
  assert.equal(useKitchen.getState().campaignComplete, true);
  assert.deepEqual(useKitchen.getState().applicants, []);
  assert.equal(nextShift(), false);
});

test('Lv1 ends immediately after one tutorial dish and can restart from its checkpoint', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ ok: true, result: { answers: { next_action: { choice: 'wait' } } } });
  };
  const moveTo = (id) => {
    useKitchen.getState().game.human.x = STATIONS[id].x;
    useKitchen.getState().game.human.y = STATIONS[id].y;
  };
  try {
    storage.delete(CHECKPOINT_KEY);
    startShift();
    assert.equal(useKitchen.getState().phase, 'playing');
    assert.equal(useKitchen.getState().tutorial, 0);
    moveTo('board');
    humanInteract();
    assert.equal(useKitchen.getState().tutorial, 0);
    assert.equal(useKitchen.getState().game.human.carrying, null);
    goTo('board');
    moveTo('crate');
    humanInteract();
    assert.equal(useKitchen.getState().tutorial, 1);
    assert.equal(useKitchen.getState().game.human.carrying, 'tomato');
    clearHands();
    assert.equal(useKitchen.getState().game.human.carrying, 'tomato');
    tick(0.5);
    const practiceGame = useKitchen.getState().game;
    const pausedAt = practiceGame.time;
    togglePause();
    tick(30);
    assert.equal(useKitchen.getState().phase, 'paused');
    assert.equal(practiceGame.time, pausedAt);
    togglePause();
    assert.equal(useKitchen.getState().phase, 'playing');
    tick(0.25);
    assert.equal(practiceGame.time, pausedAt + 250);
    graphicsLost();
    assert.equal(useKitchen.getState().ready, false);
    assert.equal(useKitchen.getState().phase, 'paused');
    startShift();
    togglePause();
    tick(30);
    assert.equal(useKitchen.getState().game, practiceGame);
    assert.equal(useKitchen.getState().phase, 'paused');
    assert.equal(practiceGame.time, pausedAt + 250);
    assert.equal(useKitchen.getState().tutorial, 1);
    assert.equal(practiceGame.human.carrying, 'tomato');
    assert.equal(calls, 0);
    useKitchen.setState({ ready: true });
    togglePause();
    assert.equal(useKitchen.getState().phase, 'playing');
    assert.equal(useKitchen.getState().tutorial, 1);
    moveTo('board');
    humanInteract();
    assert.equal(useKitchen.getState().tutorial, 2);
    moveTo('plates');
    humanInteract();
    assert.equal(useKitchen.getState().tutorial, 3);
    assert.equal(useKitchen.getState().game.human.carrying, 'plate');
    moveTo('board');
    goTo('board');
    tick(0.01);
    assert.equal(useKitchen.getState().tutorial, 3);
    tick(1);
    tick(1);
    assert.equal(useKitchen.getState().tutorial, 4);
    assert.equal(useKitchen.getState().game.human.carrying, 'dish');
    moveTo('serve');
    goTo('serve');
    assert.equal(useKitchen.getState().tutorial, null);
    assert.equal(useKitchen.getState().game.practice, true);
    assert.equal(useKitchen.getState().game.served, 1);
    assert.equal(useKitchen.getState().game.duration, Infinity);
    assert.equal(useKitchen.getState().game.orders.length, 0);
    assert.equal(useKitchen.getState().phase, 'finished');
    assert.equal(useKitchen.getState().cleared, true);
    assert.equal(useKitchen.getState().game.cash, 205);
    assert.equal(calls, 0);
    const finishedAt = useKitchen.getState().game.time;
    tick(1);
    assert.equal(useKitchen.getState().game.time, finishedAt);
    assert.equal(calls, 0);
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.equal(useKitchen.getState().tutorial, 0);
    assert.equal(useKitchen.getState().game.served, 0);
    assert.equal(useKitchen.getState().game.cash, 180);
  } finally {
    globalThis.fetch = originalFetch;
    if (useKitchen.getState().phase === 'playing') togglePause();
  }
});

test('invalid AI choices fall back and low-FPS frames keep their elapsed time', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ ok: true, result: { answers: { next_action: { choice: 'not-feasible' } } } });
  try {
    startShift();
    setMode('jev');
    tick(1);
    await new Promise(setImmediate);
    assert.equal(useKitchen.getState().fallback, true);
    assert.equal(useKitchen.getState().game.time, 1000);
    assert.equal(useKitchen.getState().hud.decisions, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (useKitchen.getState().phase === 'playing') togglePause();
  }
});

test('ordinary shifts keep a 90-second clock and inactive stations stay locked', () => {
  setMode('rule');
  startShift();
  const g = useKitchen.getState().game;
  assert.equal(g.level, 3);
  assert.equal(g.duration, SHIFT_MS);
  assert.equal(g.quota, 6);
  assert.equal(g.stock, 20);
  g.human.x = 310;
  g.human.y = 300;
  goTo('grill');
  tick(0.1);
  assert.deepEqual([g.human.x, g.human.y], [310, 300]);

  g.level = 7;
  goTo('grill');
  tick(0.1);
  assert.notDeepEqual([g.human.x, g.human.y], [310, 300]);

  g.time = SHIFT_MS;
  g.served = quotaForLevel(7);
  tick(1);
  assert.equal(useKitchen.getState().phase, 'finished');
  assert.equal(useKitchen.getState().cleared, true);
});

test('pot and grill use their full cooking time and pause freezes heating', () => {
  setMode('rule');
  for (const [id, seconds] of [
    ['pot', 12],
    ['grill', 7],
  ]) {
    useKitchen.setState({ phase: 'ready' });
    startShift();
    const g = useKitchen.getState().game;
    g.level = 10;
    Object.assign(g.human, { x: STATIONS[id].x, y: STATIONS[id].y, carrying: 'chopped' });
    humanInteract();
    const st = g.stations[id];
    assert.equal(st.state, 'cooking');
    assert.equal(st.duration, seconds * 1000);
    tick(1);
    togglePause();
    tick(30);
    assert.equal(g.time, 1000);
    assert.equal(st.state, 'cooking');
    togglePause();
    for (let second = 1; second < seconds - 1; second++) tick(1);
    assert.equal(st.state, 'cooking');
    tick(1);
    assert.equal(g.time, seconds * 1000);
    assert.equal(st.state, 'ready');
    togglePause();
  }
});

test('automatic arrival does not boost cooking, while a direct tap does', () => {
  setMode('rule');
  startShift();
  const g = useKitchen.getState().game;
  g.level = 15;
  g.human.x = STATIONS.grill.x;
  g.human.y = STATIONS.grill.y;
  g.time = 500;
  g.stations.grill.state = 'cooking';
  g.stations.grill.startedAt = 0;
  g.stations.grill.duration = 1000;
  g.stations.grill.busyUntil = 1000;
  const before = g.stations.grill.busyUntil;
  humanInteract(true);
  assert.equal(g.stations.grill.boosted, false);
  assert.equal(g.stations.grill.busyUntil, before);
  goTo('grill');
  assert.equal(g.stations.grill.boosted, true);

  g.human.x = 310;
  g.human.y = 300;
  g.time = 500;
  g.stations.grill.startedAt = 0;
  g.stations.grill.duration = 10_000;
  g.stations.grill.busyUntil = 10_000;
  g.stations.grill.boosted = false;
  goTo('grill');
  for (let i = 0; i < 4; i++) tick(1);
  assert.equal(g.stations.grill.boosted, false);
  togglePause();
});

test('leaving the screen pauses only when background mode is off and Escape leaves an open help dialog paused', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const windowListeners = new Map();
  const documentListeners = new Map();
  const fakeWindow = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener(type) {
      windowListeners.delete(type);
    },
  };
  const fakeDocument = {
    hidden: false,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type) {
      documentListeners.delete(type);
    },
  };
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  try {
    startShift();
    const cleanup = installControls();
    const typingTargets = [
      { closest: (selector) => (selector.includes('textarea') ? {} : null) },
      { closest: (selector) => (selector.includes('[contenteditable="true"]') ? {} : null) },
    ];
    for (const target of typingTargets) {
      for (const key of ['w', 'a', 's', 'd', 'e', 'shift', 'q', 'escape']) {
        windowListeners.get('keydown')({
          key,
          repeat: false,
          target,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          preventDefault() {
            throw new Error('typing shortcut was intercepted');
          },
        });
      }
    }
    windowListeners.get('keydown')({
      key: 'w',
      repeat: false,
      target: {},
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {},
    });
    assert.equal(useKitchen.getState().phase, 'playing');
    assert.equal(useKitchen.getState().game.time, 0);
    // Leaving the screen pauses only when background mode is off.
    windowListeners.get('blur')();
    fakeDocument.hidden = true;
    documentListeners.get('visibilitychange')();
    assert.equal(useKitchen.getState().phase, 'playing');
    toggleBackgroundMode();
    windowListeners.get('blur')();
    assert.equal(useKitchen.getState().phase, 'paused');
    setMenuOpen(true);
    togglePause();
    assert.equal(useKitchen.getState().phase, 'paused');
    windowListeners.get('keydown')({
      key: 'Escape',
      repeat: false,
      target: { closest: () => null },
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    });
    assert.equal(useKitchen.getState().phase, 'paused');
    assert.equal(useKitchen.getState().menuOpen, false);
    windowListeners.get('keydown')({
      key: 'Escape',
      repeat: false,
      target: { closest: () => null },
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    });
    assert.equal(useKitchen.getState().phase, 'playing');
    windowListeners.get('keydown')({
      key: 'Escape',
      repeat: true,
      target: { closest: () => null },
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    });
    assert.equal(useKitchen.getState().phase, 'playing');
    cleanup();
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    if (useKitchen.getState().phase === 'playing') togglePause();
  }
});

test('graphics loss invalidates the active decision and pauses the shift', async () => {
  const originalFetch = globalThis.fetch;
  let resolve;
  globalThis.fetch = () =>
    new Promise((done) => {
      resolve = done;
    });
  try {
    startShift();
    setMode('jev');
    tick(0.05);
    assert.equal(typeof resolve, 'function');
    graphicsLost();
    resolve(
      Response.json({ ok: true, result: { answers: { next_action: { choice: 'fetch_tomato' } } } }),
    );
    await new Promise(setImmediate);
    assert.equal(useKitchen.getState().phase, 'paused');
    assert.equal(useKitchen.getState().ready, false);
    assert.equal(useKitchen.getState().game.ai.intent, null);
    assert.equal(useKitchen.getState().hud.decisions, 0);
    togglePause();
    startShift();
    assert.equal(useKitchen.getState().phase, 'paused');
  } finally {
    globalThis.fetch = originalFetch;
    if (useKitchen.getState().phase === 'playing') togglePause();
  }
});

test('the manager teaches Lv2 and Lv3, retires before Lv4, and retries preserve wages', () => {
  storage.delete(CHECKPOINT_KEY);
  startShift();
  const tutorial = useKitchen.getState().game;
  tutorial.served = 1;
  tutorial.cash += 25;
  tick(0);
  assert.equal(nextShift(null, 11, ['helper']), false);
  assert.equal(nextShift(), true);
  assert.deepEqual(useKitchen.getState().game.duty, ['veteran']);
  assert.equal(useKitchen.getState().game.cash, 205 - 13 * 8 - STAFF.veteran.wage);
  for (let level = 2; level <= 8; level++) {
    let g = useKitchen.getState().game;
    const opening = JSON.parse(storage.get(CHECKPOINT_KEY));
    g.time = SHIFT_MS;
    tick(0);
    assert.equal(retryShift(), true);
    g = useKitchen.getState().game;
    assert.equal(g.cash, opening.cash);
    assert.deepEqual(g.duty, level <= 3 ? ['veteran'] : ['helper']);
    if (level >= 4) assert.ok(!g.hired.includes('veteran'));
    g.served = g.quota;
    g.stock -= g.served;
    g.cash += g.served * 25;
    g.time = SHIFT_MS;
    tick(0);
    if (level === 3) assert.equal(nextShift(null, 12, ['veteran']), false);
    const cash = g.cash;
    const purchased = recommendedStock(g);
    assert.equal(nextShift(), true);
    const next = useKitchen.getState().game;
    assert.equal(
      next.cash,
      cash - purchased * 8 - (level === 2 ? STAFF.veteran.wage : STAFF.helper.wage),
    );
    assert.deepEqual(next.duty, level === 2 ? ['veteran'] : ['helper']);
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.deepEqual(useKitchen.getState().game.hired, next.hired);
    assert.equal(useKitchen.getState().game.cash, next.cash);
  }
});

test('the manager can demonstrate service but the apprentice cannot clear Lv4 unattended', () => {
  const results = [];
  for (const level of [2, 4]) {
    setMode('rule');
    const game = createGame({ level, stock: 20 });
    useKitchen.setState({ game, phase: 'playing', tutorial: null, sound: false });
    for (let frame = 0; frame <= 1800; frame++) tick(0.05);
    results.push({
      served: game.served,
      quota: game.quota,
      cleared: useKitchen.getState().cleared,
    });
  }
  assert.equal(results[0].cleared, true);
  assert.equal(results[1].cleared, false);
  assert.ok(results[0].served > results[1].served);
});

test('balance migration preserves old paid openings and tops up only valid legacy stock', () => {
  const legacy = { version: 2, ...createGame({ level: 3, cash: 417, stock: 8 }), completed: false };
  storage.set(CHECKPOINT_KEY, JSON.stringify(legacy));
  startShift();
  assert.equal(useKitchen.getState().game.level, 3);
  assert.equal(useKitchen.getState().game.cash, 417);
  assert.equal(useKitchen.getState().game.stock, 8);
  assert.equal(JSON.parse(storage.get(CHECKPOINT_KEY)).version, 5);
  useKitchen.setState({ phase: 'ready' });
  startShift();
  assert.equal(useKitchen.getState().game.stock, 8);
  assert.equal(useKitchen.getState().game.cash, 417);
});

test('retired manager candidates have a one-percent gate and require a paid rehire', (t) => {
  let draw = 0.01;
  t.mock.method(Math, 'random', () => draw);
  for (const chance of [0.01, 0.5, 0.009999]) {
    draw = chance;
    const game = createGame({ level: 3, stock: 11, cash: 2000 });
    useKitchen.setState({ game, phase: 'playing', tutorial: null, cleared: false });
    game.served = game.quota;
    game.time = SHIFT_MS;
    tick(0);
    const applicants = useKitchen.getState().applicants;
    assert.equal(applicants.includes('veteran'), chance < 0.01);
    assert.equal(applicants.length, 3);
    assert.equal(new Set(applicants).size, 3);
  }
  assert.equal(nextShift('veteran', 0, ['veteran']), true);
  const rehired = useKitchen.getState().game;
  assert.equal(rehired.cash, 2000 - STAFF.veteran.cost - STAFF.veteran.wage);
  assert.deepEqual(rehired.duty, ['veteran']);
  assert.ok(rehired.hired.includes('veteran'));
  useKitchen.setState({ phase: 'ready' });
  startShift();
  assert.deepEqual(useKitchen.getState().game.duty, ['veteran']);
  draw = 0;
  const g = useKitchen.getState().game;
  g.served = g.quota;
  g.time = SHIFT_MS;
  tick(0);
  assert.ok(!useKitchen.getState().applicants.includes('veteran'));
});

test('mentor retirement offers a cooking hire and preserves trained campaign saves', (t) => {
  for (const random of [0, 0.2, 0.5, 0.99]) {
    t.mock.method(Math, 'random', () => random);
    const g = createGame({
      level: 3,
      cash: 600,
      stock: 15,
      training: { human: { move: 1, cook: 1 }, veteran: { move: 1, cook: 0 } },
    });
    useKitchen.setState({ game: g, phase: 'playing', tutorial: null, cleared: false });
    g.served = g.quota;
    g.time = SHIFT_MS;
    tick(0);
    assert.ok(useKitchen.getState().applicants.some((id) => id === 'chef' || id === 'sous'));
    assert.equal(nextShift(null, 0, ['helper']), true);
    const next = useKitchen.getState().game;
    assert.deepEqual(next.training, { human: { move: 1, cook: 1 } });
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.equal(useKitchen.getState().game.level, 4);
    assert.deepEqual(useKitchen.getState().game.training, next.training);
  }
});

test('previous saves adopt the new mentor lessons without losing cash or rewinds', () => {
  const legacyOpening = (level) => {
    const g = createGame({
      level,
      stock: 11,
      cash: 431,
      hired: ['helper', 'veteran'],
      duty: ['helper'],
    });
    return {
      ...g,
      version: 3,
      completed: false,
      duty: ['helper'],
      staffState: { helper: { worked: 0, rest: 0 }, veteran: { worked: 0, rest: 5 } },
    };
  };
  const saved = legacyOpening(4);
  saved.rollback = {
    preparation: { snapshot: legacyOpening(3), applicants: ['chef'] },
    previous: { snapshot: legacyOpening(3), applicants: ['chef'] },
  };
  storage.set(CHECKPOINT_KEY, JSON.stringify(saved));
  startShift();
  let g = useKitchen.getState().game;
  assert.equal(g.level, 4);
  assert.equal(g.cash, 431);
  assert.deepEqual(g.hired, ['helper']);
  assert.deepEqual(g.duty, ['helper']);
  const updated = JSON.parse(storage.get(CHECKPOINT_KEY));
  assert.equal(updated.version, 5);
  assert.deepEqual(updated.rollback.previous.snapshot.duty, ['veteran']);
  assert.equal(updated.rollback.previous.snapshot.cash, 431);
  storage.set(CHECKPOINT_KEY, JSON.stringify(legacyOpening(3)));
  useKitchen.setState({ phase: 'ready' });
  startShift();
  g = useKitchen.getState().game;
  assert.equal(g.level, 3);
  assert.equal(g.cash, 431);
  assert.deepEqual(g.duty, ['veteran']);
  assert.deepEqual(g.staffState.veteran, { worked: 0, rest: 0 });
});

test('easier quotas preserve paid openings, rehired staff and rewind stock', () => {
  for (const version of [3, 4, 5]) {
    for (const level of [5, 6, 7]) {
      for (const stock of [8, 9, 12]) {
        const opening = {
          ...createGame({
            level,
            stock,
            cash: 431,
            hired: ['helper', 'veteran'],
            duty: ['helper'],
          }),
          version,
          completed: false,
        };
        opening.rollback = { previous: { snapshot: { ...opening }, applicants: ['chef'] } };
        storage.set(CHECKPOINT_KEY, JSON.stringify(opening));
        useKitchen.setState({ phase: 'ready' });
        startShift();
        const g = useKitchen.getState().game;
        if (stock < quotaForLevel(level)) {
          assert.equal(g.level, 1);
          continue;
        }
        assert.equal(g.level, level);
        assert.equal(g.stock, Math.max(stock, quotaForLevel(level)));
        assert.equal(g.cash, 431);
        assert.equal(g.hired.includes('veteran'), version >= 4);
        const saved = JSON.parse(storage.get(CHECKPOINT_KEY));
        assert.equal(saved.version, 5);
        assert.equal(saved.rollback.previous.snapshot.stock, Math.max(stock, quotaForLevel(level)));
        useKitchen.setState({ phase: 'ready' });
        startShift();
        assert.equal(useKitchen.getState().game.stock, saved.stock);
        assert.equal(useKitchen.getState().game.cash, saved.cash);
      }
    }
  }
});

test('E hands items to nearby partners while tapping a station still works there', () => {
  startShift();
  const g = useKitchen.getState().game;
  Object.assign(g.human, { ...STATIONS.board, carrying: 'tomato' });
  Object.assign(g.ai, { x: g.human.x + 20, y: g.human.y, carrying: null });
  humanInteract();
  assert.equal(g.human.carrying, null);
  assert.equal(g.ai.carrying, 'tomato');
  g.human.carrying = 'plate';
  humanInteract();
  assert.equal(g.human.carrying, 'plate');
  g.human.carrying = 'tomato';
  g.ai.carrying = null;
  goTo('board');
  assert.equal(g.stations.board.state, 'chopping');
  assert.equal(g.ai.carrying, null);
});
