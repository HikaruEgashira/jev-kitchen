import assert from 'node:assert/strict';
import test from 'node:test';
import {
  useKitchen,
  startShift,
  setMode,
  setPolicy,
  togglePause,
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
import { STATIONS, SHIFT_MS, MAX_LEVEL, quotaForLevel } from '../src/model.js';
import { STAFF } from '../src/staff.js';

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
  useKitchen.setState({ ready: true, phase: 'ready' });
});

test('a 90-second shift clears only after its quota and offers three applicants', () => {
  startShift();
  const g = useKitchen.getState().game;
  g.served = 6;
  g.time = SHIFT_MS;
  tick(1);
  assert.equal(useKitchen.getState().phase, 'finished');
  assert.equal(useKitchen.getState().cleared, true);
  assert.equal(useKitchen.getState().applicants.length, 3);
  assert.equal(new Set(useKitchen.getState().applicants).size, 3);
  assert.ok(
    useKitchen.getState().applicants.every((id) => id !== 'helper' && !g.hired.includes(id)),
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
    startShift();
    assert.equal(useKitchen.getState().celebration, 0);
    setMode('jev');
    tick(0.05);
    assert.equal(typeof resolve, 'function');
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
      useKitchen.getState().game.staffId = staffId;
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
    useKitchen.getState().game.staffId = 'veteran';
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
  assert.equal(next.stock, quotaForLevel(3) + 2);
  assert.equal(next.cash, 300 - (quotaForLevel(3) + 2 - 4) * 8);
});

test('opening checkpoints resume progress without farming and reject corrupt saves', async () => {
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
    JSON.stringify({ ...opening, staffId: 'veteran' }),
    JSON.stringify({ ...opening, hired: ['helper', 'constructor'] }),
  ]) {
    storage.set(CHECKPOINT_KEY, bad);
    useKitchen.setState({ phase: 'ready' });
    startShift();
    assert.equal(useKitchen.getState().game.level, 1);
    assert.equal(useKitchen.getState().game.cash, 120);
  }
});

test('cleared shifts transact one applicant and stock for the next level', () => {
  startShift();
  const g = useKitchen.getState().game;
  g.cash = 1000;
  g.served = 6;
  g.time = SHIFT_MS;
  tick(1);
  const applicant = useKitchen.getState().applicants[0];
  assert.equal(nextShift(applicant), true);
  const next = useKitchen.getState().game;
  assert.equal(next.level, 2);
  assert.equal(next.duration, SHIFT_MS);
  assert.equal(next.stock, 10);
  assert.equal(next.staffId, applicant);
  assert.ok(next.hired.includes(applicant));
  assert.equal(next.cash, 1000 - STAFF[applicant].cost - 10 * 8);
});

test('skipping keeps the active staff and failed shifts retry from their opening snapshot', () => {
  startShift();
  const g = useKitchen.getState().game;
  g.cash = 300;
  g.served = 6;
  g.time = SHIFT_MS;
  tick(1);
  assert.equal(nextShift(null, 8), true);
  assert.equal(useKitchen.getState().game.staffId, 'helper');
  assert.equal(useKitchen.getState().game.stock, 8);

  startShift();
  const failed = useKitchen.getState().game;
  failed.cash = 42;
  failed.time = SHIFT_MS;
  tick(1);
  assert.equal(useKitchen.getState().cleared, false);
  failed.cash = 0;
  assert.equal(retryShift(), true);
  assert.equal(useKitchen.getState().game.cash, 120);
  assert.equal(useKitchen.getState().game.level, 1);
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

test('first startShift runs onboarding once, then continues into the normal shift', async () => {
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
    storage.delete('sidekick-onboarded-v1');
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
    assert.equal(useKitchen.getState().game.practice, false);
    assert.equal(useKitchen.getState().game.served, 1);
    assert.equal(useKitchen.getState().game.time, 0);
    assert.equal(useKitchen.getState().game.duration, SHIFT_MS);
    assert.equal(useKitchen.getState().game.orders.length, 2);
    assert.equal(useKitchen.getState().phase, 'playing');
    assert.equal(storage.get('sidekick-onboarded-v1'), '1');
    tick(1);
    assert.equal(useKitchen.getState().game.time, 1000);
    assert.equal(useKitchen.getState().phase, 'playing');
    assert.equal(calls, 1);
    startShift();
    assert.equal(useKitchen.getState().tutorial, null);
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

test('every campaign level keeps a 90-second clock and inactive stations stay locked', () => {
  setMode('rule');
  startShift();
  const g = useKitchen.getState().game;
  assert.equal(g.level, 1);
  assert.equal(g.duration, SHIFT_MS);
  assert.equal(g.quota, 6);
  assert.equal(g.stock, null);
  g.human.x = 310;
  g.human.y = 300;
  goTo('pot');
  tick(0.1);
  assert.deepEqual([g.human.x, g.human.y], [310, 300]);

  g.level = 2;
  goTo('pot');
  tick(0.1);
  assert.notDeepEqual([g.human.x, g.human.y], [310, 300]);

  g.time = SHIFT_MS;
  g.served = 8;
  tick(1);
  assert.equal(useKitchen.getState().phase, 'finished');
  assert.equal(useKitchen.getState().cleared, true);
});

test('automatic arrival does not boost cooking, while a direct tap does', () => {
  setMode('rule');
  startShift();
  const g = useKitchen.getState().game;
  g.level = 3;
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

test('blur pauses and Escape leaves an open help dialog paused', () => {
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
    dialogOpen: false,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type) {
      documentListeners.delete(type);
    },
    querySelector() {
      return this.dialogOpen ? {} : null;
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
    windowListeners.get('blur')();
    assert.equal(useKitchen.getState().phase, 'paused');
    fakeDocument.dialogOpen = true;
    windowListeners.get('keydown')({
      key: 'Escape',
      repeat: false,
      target: { closest: () => null },
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    });
    assert.equal(useKitchen.getState().phase, 'paused');
    fakeDocument.dialogOpen = false;
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
