import assert from 'node:assert/strict';
import test from 'node:test';
import { useKitchen, startShift, setMode, togglePause, tick } from '../src/game.js';

test('reset discards an in-flight AI answer, and pause freezes the shift', async () => {
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
