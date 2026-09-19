import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('graphics retry waits for disposal once and ignores retired generations', async () => {
  // ponytail: run the actual JSX handler in Node; real GPU behavior still needs browser QA.
  const source = readFileSync(new URL('../src/Kitchen.jsx', import.meta.url), 'utf8');
  const handler = source.match(/  const retryGraphics = async \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(handler, 'Kitchen must expose its retry handler to this regression check');
  const disposal = Promise.withResolvers();
  const renderer = {};
  let disposals = 0;
  let remounts = 0;
  let resets = 0;
  let error = true;
  const refs = {
    resetFont: () => resets++,
    retryInFlight: { current: false },
    graphicsGeneration: { current: 0 },
    rendererDisposeRef: {
      current: () => {
        disposals += 1;
        return disposal.promise;
      },
    },
    rendererRef: { current: renderer },
    initialization: { current: Promise.resolve(renderer) },
    setError: (value) => {
      error = value;
    },
    setGraphicsKey: (update) => {
      remounts = update(remounts);
    },
  };
  const retry = runInNewContext(`${handler[0]}\nretryGraphics;`, refs);
  const first = retry();
  try {
    await retry();
    await retry();
    assert.equal(refs.graphicsGeneration.current, 1);
    assert.equal(disposals, 1);
    assert.equal(remounts, 0, 'repeated clicks must not bypass pending disposal');
    assert.equal(resets, 0);
    assert.equal(error, true);
    assert.equal(refs.rendererRef.current, renderer);
  } finally {
    disposal.resolve();
    await first;
  }
  assert.equal(remounts, 1);
  assert.equal(resets, 1);
  assert.equal(error, false);
  assert.equal(refs.rendererRef.current, null);
  assert.equal(refs.initialization.current, null);

  const delayed = Promise.withResolvers();
  refs.rendererDisposeRef.current = () => delayed.promise;
  const retired = retry();
  refs.graphicsGeneration.current += 1;
  const replacement = {};
  refs.rendererRef.current = replacement;
  error = true;
  delayed.resolve();
  await retired;
  assert.equal(remounts, 1, 'unmount or canvas replacement retires the pending retry');
  assert.equal(resets, 1);
  assert.equal(refs.rendererRef.current, replacement);
  assert.equal(error, true);

  await retry();
  assert.equal(remounts, 2, 'the guard must release after a retired retry');
  assert.equal(resets, 2);
  assert.equal(error, false);
});
