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
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

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

test('rejects non-string or malformed choice criteria before billing', async () => {
  calls.length = 0;
  const res = await worker.fetch(
    post('/api/decide', {
      state: 'x',
      questions: {
        next_action: {
          type: 'choice',
          criteria: { wait: null, serve: 'serve' },
        },
      },
    }),
    env(),
  );
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);

  const malformedId = await worker.fetch(
    post('/api/decide', {
      state: 'x',
      questions: {
        next_action: {
          type: 'choice',
          criteria: { '-wait': 'wait', serve: 'serve' },
        },
      },
    }),
    env(),
  );
  assert.equal(malformedId.status, 400);
  assert.equal(calls.length, 0);
});

test('rejects an oversized request before parsing or billing', async () => {
  calls.length = 0;
  const res = await worker.fetch(
    post('/api/decide', {
      state: 'x'.repeat(70_000),
      questions: validQuestions,
    }),
    env(),
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'request body too large');
  assert.equal(calls.length, 0);
});

test('times out a stalled request body before billing the model', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let callsForTimeout = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 8_000) {
      callback(...args);
      return 0;
    }
    return originalSetTimeout(callback, delay, ...args);
  };
  globalThis.clearTimeout = (timer) => originalClearTimeout(timer);
  try {
    const request = new Request('https://kitchen.test/api/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({ start() {} }),
      duplex: 'half',
    });
    const response = await worker.fetch(request, {
      AI: {
        async run() {
          callsForTimeout++;
          return {};
        },
      },
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'request body timeout');
    assert.equal(callsForTimeout, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('method and route guards', async () => {
  const get = new Request('https://kitchen.test/api/decide');
  assert.equal((await worker.fetch(get, env())).status, 405);
  const missing = new Request('https://kitchen.test/api/nope');
  assert.equal((await worker.fetch(missing, env())).status, 404);
});

test('health is GET-only and rejects other methods before billing', async () => {
  calls.length = 0;
  for (const method of ['HEAD', 'POST', 'PUT']) {
    const response = await worker.fetch(
      new Request('https://kitchen.test/api/health', { method }),
      env(),
    );
    assert.equal(response.status, 405);
  }
  assert.equal(calls.length, 0);
});

test('GET health returns only operational metadata', async () => {
  calls.length = 0;
  const response = await worker.fetch(new Request('https://kitchen.test/api/health'), {
    AI: {
      async run(model, input) {
        calls.push({ model, input });
        return {
          model: 'jev-1.13.0',
          details: 'provider metadata is discarded',
          answers: { next_action: { type: 'choice', choice: 'wait' } },
        };
      },
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.model, 'typesafe/jev');
  assert.equal(body.answers, undefined);
  assert.equal(body.usage, undefined);
  assert.equal(calls.length, 1);
});

test('health rejects a successful upstream error envelope without leaking details', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: 'secret health error', details: 'private health context' });
  try {
    const response = await worker.fetch(new Request('https://kitchen.test/api/health'), {
      TYPESAFE_API_KEY: 'sk-test',
      AI: { run: async () => ({}) },
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, 'upstream unavailable');
    assert.doesNotMatch(JSON.stringify(body), /secret health error|private health context/);
  } finally {
    globalThis.fetch = original;
  }
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

test('the LLM baseline rejects arbitrary models and malformed candidates', async () => {
  const llmEnv = {
    AI: {
      async run() {
        throw new Error('must not run');
      },
    },
  };
  const unsupported = await worker.fetch(
    post('/api/decide-llm', {
      state: { policy: null },
      model: 'expensive-or-unknown-model',
      candidates: [{ id: 'wait', label: 'wait' }],
    }),
    llmEnv,
  );
  assert.equal(unsupported.status, 400);
  assert.equal((await unsupported.json()).error, 'unsupported model');

  const malformed = await worker.fetch(
    post('/api/decide-llm', {
      state: { policy: null },
      candidates: [{ id: '-wait', label: 'wait' }],
    }),
    llmEnv,
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'candidate id and label are invalid');
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

test('rejects a successful upstream error envelope without forwarding details', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: 'secret provider error', details: 'private upstream context' });
  try {
    const res = await worker.fetch(post('/api/decide', { state: 'x', questions: validQuestions }), {
      TYPESAFE_API_KEY: 'sk-test',
      AI: { run: async () => ({}) },
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'upstream unavailable');
    assert.doesNotMatch(JSON.stringify(body), /secret provider error|private upstream context/);
  } finally {
    globalThis.fetch = original;
  }
});

test('a failed direct call returns a sanitized upstream error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('insufficient credits', { status: 402 });
  try {
    const res = await worker.fetch(post('/api/decide', { state: 'x', questions: validQuestions }), {
      TYPESAFE_API_KEY: 'sk-test',
      AI: { run: async () => ({}) },
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.via, 'typesafe-api');
    assert.equal(body.error, 'upstream unavailable');
    assert.doesNotMatch(JSON.stringify(body), /insufficient credits/);
  } finally {
    globalThis.fetch = original;
  }
});
