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
  assert.equal(body.via, 'workers-ai');
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

test('a TypeSafe key switches /api/decide to the direct API', async () => {
  const original = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization };
    return new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: { next_action: { type: 'choice', choice: 'serve' } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const res = await worker.fetch(
      post('/api/decide', { state: { policy: 'x' }, questions: validQuestions }),
      {
        TYPESAFE_API_KEY: 'sk-test',
        AI: {
          async run() {
            throw new Error('the Workers AI binding must not be used');
          },
        },
      },
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.via, 'typesafe-api');
    assert.equal(body.result.answers.next_action.choice, 'serve');
    assert.equal(seen.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(seen.auth, 'Bearer sk-test');
    assert.equal(seen.body.model, 'jev-latest');
    assert.deepEqual(seen.body.questions, validQuestions);
  } finally {
    globalThis.fetch = original;
  }
});

test('a failed direct call surfaces the upstream status and body', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('insufficient credits', { status: 402 });
  try {
    const res = await worker.fetch(
      post('/api/decide', { state: 'x', questions: validQuestions }),
      { TYPESAFE_API_KEY: 'sk-test', AI: { run: async () => ({}) } },
    );
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.via, 'typesafe-api');
    assert.match(body.error, /402/);
  } finally {
    globalThis.fetch = original;
  }
});
