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
  startTutorial,
  humanInteract,
  goTo,
  clearHands,
} from '../src/game.js';
import { STATIONS } from '../src/model.js';

test.beforeEach(() => useKitchen.setState({ ready: true, phase: 'ready' }));

test('corrupt best-score storage is normalized to a finite non-negative integer', async () => {
  const originalWindow = globalThis.window;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([['sidekick-best', '12.9']]);
  globalThis.window = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => values.get(key) ?? null },
  });
  try {
    const fractional = await import(`../src/game.js?best-score-fractional-${Date.now()}`);
    assert.equal(fractional.useKitchen.getState().best, 12);
    values.set('sidekick-best', 'Infinity');
    const infinite = await import(`../src/game.js?best-score-infinite-${Date.now()}`);
    assert.equal(infinite.useKitchen.getState().best, 0);
    values.set('sidekick-best', '-1');
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

test('hands-on tutorial gates the station sequence and does not invoke AI', async () => {
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
    startTutorial();
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
    tick(0.01);
    assert.equal(useKitchen.getState().tutorial, 5);
    assert.equal(useKitchen.getState().phase, 'playing');
    tick(30);
    assert.equal(useKitchen.getState().tutorial, 5);
    assert.equal(useKitchen.getState().phase, 'playing');
    assert.equal(calls, 0);
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
