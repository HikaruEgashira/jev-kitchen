import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/worker.ts';

// Node strips the TypeScript in src/worker.ts, so the real handler runs here.
// env.AI is a stub: this checks our validation and forwarding, not Jev itself.
const calls = [];
const env = () => ({
  AI: {
    async run(model, input) {
      calls.push({ model, input });
      return {
        model: 'jev-1.13.0',
        answers: { next_action: { type: 'choice', choice: 'wait', confidence: 0.91 } },
      };
    },
  },
});

const post = (path, body) =>
  new Request(`https://kitchen.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const validQuestions = {
  next_action: {
    type: 'choice',
    instructions: 'pick one',
    criteria: { wait: 'wait and watch', serve: 'serve the dish' },
  },
};

test('forwards a valid decision to Jev and returns the answer', async () => {
  calls.length = 0;
  const res = await worker.fetch(
    post('/api/decide', { state: { policy: null }, questions: validQuestions }),
    env(),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.engine, 'jev');
  assert.equal(body.result.answers.next_action.choice, 'wait');
  assert.equal(typeof body.upstreamMs, 'number');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'typesafe/jev');
  assert.deepEqual(calls[0].input.state, { policy: null });
});

test('rejects a choice question with only one option before billing the model', async () => {
  calls.length = 0;
  const res = await worker.fetch(
    post('/api/decide', {
      state: 'x',
      questions: { next_action: { type: 'choice', criteria: { only: 'one' } } },
    }),
    env(),
  );
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('rejects unknown question types', async () => {
  const res = await worker.fetch(
    post('/api/decide', { state: 'x', questions: { q: { type: 'essay' } } }),
    env(),
  );
  assert.equal(res.status, 400);
});

test('method and route guards', async () => {
  const get = new Request('https://kitchen.test/api/decide');
  assert.equal((await worker.fetch(get, env())).status, 405);
  const missing = new Request('https://kitchen.test/api/nope');
  assert.equal((await worker.fetch(missing, env())).status, 404);
});

test('the LLM baseline picks a valid id and does not confuse substrings', async () => {
  const llmEnv = {
    AI: {
      async run() {
        return { response: 'fetch_plate' };
      },
    },
  };
  const res = await worker.fetch(
    post('/api/decide-llm', {
      state: { policy: null },
      candidates: [
        { id: 'plate', label: 'plate it' },
        { id: 'fetch_plate', label: 'fetch a plate' },
      ],
    }),
    llmEnv,
  );
  const body = await res.json();
  assert.equal(body.result.answers.next_action.choice, 'fetch_plate');
});
