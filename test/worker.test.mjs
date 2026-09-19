import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { GameStore } from '../src/worker.ts';
import { signTicket } from '../src/session.ts';
import { memoryRunStore } from '../src/run-store.ts';
import { runReplayCampaign, RANKED_PROTOCOL } from '../src/replay.js';

// Node strips the TypeScript in src/worker.ts, so the real handler runs here.
// env.AI is a stub: this checks our validation and forwarding, not Jev itself.
const calls = [];
const SECRET = 'test-secret-value-1234';
const playTicket = await signTicket(SECRET, {
  sid: 'play-run',
  seed: 1,
  mode: 'play',
  exp: Date.now() + 3_600_000,
});
const benchSid = 'bench-run';
const benchTicket = await signTicket(SECRET, {
  sid: benchSid,
  seed: 2,
  mode: 'bench',
  exp: Date.now() + 3_600_000,
});
const env = () => ({
  TICKET_SECRET: SECRET,
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

const ticketFor = (path) =>
  path === '/api/bench/decide' || path === '/api/runs/finish' ? benchTicket : playTicket;

const post = (path, body, ticket = ticketFor(path)) =>
  new Request(`https://kitchen.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-run-ticket': ticket },
    body: JSON.stringify(body),
  });

const validQuestions = {
  next_action: {
    type: 'choice',
    instructions: 'pick one',
    criteria: { wait: 'wait and watch', serve: 'serve the dish' },
  },
};

test('benchmark registry exposes labels only and forwards only to a server-registered endpoint', async (t) => {
  const configured = {
    ...env(),
    BENCH_ENDPOINTS: JSON.stringify({
      custom: {
        name: 'Custom model',
        url: 'https://model.example/decision',
        token: 'test-secret',
        model: 'test-model',
      },
    }),
  };
  const registry = await worker.fetch(
    new Request('https://kitchen.test/api/bench/models'),
    configured,
  );
  assert.deepEqual(await registry.json(), {
    models: [
      { id: 'jev', name: 'Jev' },
      { id: 'custom', name: 'Custom model' },
    ],
  });
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://model.example/decision');
    assert.equal(options.headers.authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'manual');
    assert.equal(JSON.parse(options.body).model, 'test-model');
    return Response.json({
      answers: { next_action: { choice: 'wait' } },
      secret_metadata: 'private',
    });
  });
  const body = {
    modelId: 'custom',
    state: {},
    questions: validQuestions,
    url: 'https://untrusted.example/',
  };
  const response = await worker.fetch(post('/api/bench/decide', body), configured);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.answers.next_action.choice, 'wait');
  for (const modelId of ['missing', '__proto__']) {
    assert.equal(
      (await worker.fetch(post('/api/bench/decide', { ...body, modelId }), configured)).status,
      400,
    );
  }
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () =>
    Response.json({ answers: { next_action: { choice: 'outside' } } }),
  );
  assert.equal((await worker.fetch(post('/api/bench/decide', body), configured)).status, 502);
});

test('benchmark default Jev and configuration guards preserve the request boundary', async () => {
  const body = { modelId: 'jev', state: {}, questions: validQuestions };
  assert.equal((await worker.fetch(post('/api/bench/decide', body), env())).status, 200);
  assert.equal(
    (await worker.fetch(new Request('https://kitchen.test/api/bench/decide'), env())).status,
    405,
  );
  for (const BENCH_ENDPOINTS of ['[]', '{', '{"bad":{"url":"http://model.example"}}']) {
    assert.equal(
      (await worker.fetch(post('/api/bench/decide', body), { ...env(), BENCH_ENDPOINTS })).status,
      503,
    );
  }
  const questions = { other: validQuestions.next_action };
  assert.equal(
    (await worker.fetch(post('/api/bench/decide', { ...body, questions }), env())).status,
    400,
  );
});

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
      headers: { 'content-type': 'application/json', 'x-run-ticket': playTicket },
      body: new ReadableStream({ start() {} }),
      duplex: 'half',
    });
    const response = await worker.fetch(request, {
      TICKET_SECRET: SECRET,
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

test('health is GET-only and reports configuration without billing the model', async () => {
  calls.length = 0;
  for (const method of ['HEAD', 'POST', 'PUT']) {
    const response = await worker.fetch(
      new Request('https://kitchen.test/api/health', { method }),
      env(),
    );
    assert.equal(response.status, 405);
  }
  for (const direct of [false, true]) {
    const testEnv = direct ? { ...env(), TYPESAFE_API_KEY: 'sk-test' } : env();
    const response = await worker.fetch(new Request('https://kitchen.test/api/health'), testEnv);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['configured', 'engine', 'model', 'ok', 'via']);
    assert.equal(body.ok, true);
    assert.equal(body.engine, 'jev');
    assert.equal(body.via, direct ? 'typesafe-api' : 'workers-ai');
    assert.equal(body.model, direct ? 'jev-latest' : 'typesafe/jev');
    assert.deepEqual(body.configured, { sessions: true, rateLimit: false });
    assert.doesNotMatch(JSON.stringify(body), /answers|usage|upstreamMs/);
  }
  assert.equal(calls.length, 0, 'health must never reach the model');
});

for (const direct of [false, true]) {
  test(`decide validates and projects next_action (${direct ? 'direct' : 'binding'})`, async (t) => {
    let raw = {
      answers: {
        next_action: { type: 'choice', choice: 'wait', confidence: 0.9, private: 'hidden' },
        ok: { type: 'noul', noul: 0.99 },
      },
      usage: { input_tokens: 12 },
      details: 'private provider metadata',
    };
    const testEnv = { TICKET_SECRET: SECRET, AI: { run: async () => raw } };
    if (direct) {
      testEnv.TYPESAFE_API_KEY = 'sk-test';
      t.mock.method(globalThis, 'fetch', async () => Response.json(raw));
    }
    const response = await worker.fetch(
      post('/api/decide', { state: 'x', questions: validQuestions }),
      testEnv,
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, {
      answers: { next_action: { type: 'choice', choice: 'wait', confidence: 0.9 } },
    });
    raw = { answers: { ok: { type: 'noul', noul: 0.99 } }, details: 'private provider metadata' };
    const invalid = await worker.fetch(
      post('/api/decide', { state: 'x', questions: validQuestions }),
      testEnv,
    );
    assert.equal(invalid.status, 502);
    assert.equal((await invalid.json()).error, 'upstream unavailable');
  });
}

test('the LLM baseline picks a valid id and does not confuse substrings', async () => {
  const llmEnv = {
    TICKET_SECRET: SECRET,
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
    TICKET_SECRET: SECRET,
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
        TICKET_SECRET: SECRET,
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
      TICKET_SECRET: SECRET,
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
      TICKET_SECRET: SECRET,
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

test('session issues a mode-scoped run ticket and rejects bad input', async () => {
  const response = await worker.fetch(
    new Request('https://kitchen.test/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'bench' }),
    }),
    env(),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'bench');
  assert.equal(typeof body.ticket, 'string');
  assert.ok(Number.isSafeInteger(body.seed));
  assert.ok(body.expiresAt > Date.now());

  const wrongMethod = await worker.fetch(new Request('https://kitchen.test/api/session'), env());
  assert.equal(wrongMethod.status, 405);
  const badMode = await worker.fetch(
    new Request('https://kitchen.test/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'admin' }),
    }),
    env(),
  );
  assert.equal(badMode.status, 400);
  const unconfigured = await worker.fetch(
    new Request('https://kitchen.test/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'play' }),
    }),
    { AI: { run: async () => ({}) } },
  );
  assert.equal(unconfigured.status, 503);
});

test('billed routes require a valid ticket before the model is touched', async () => {
  calls.length = 0;
  const noTicket = await worker.fetch(
    new Request('https://kitchen.test/api/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'x', questions: validQuestions }),
    }),
    env(),
  );
  assert.equal(noTicket.status, 401);

  const crossed = await worker.fetch(
    post(
      '/api/bench/decide',
      { modelId: 'jev', state: 'x', questions: validQuestions },
      playTicket,
    ),
    env(),
  );
  assert.equal(crossed.status, 401);

  const expired = await signTicket(SECRET, {
    sid: 'old',
    seed: 3,
    mode: 'play',
    exp: Date.now() - 1000,
  });
  const stale = await worker.fetch(
    post('/api/decide', { state: 'x', questions: validQuestions }, expired),
    env(),
  );
  assert.equal(stale.status, 401);

  const wrongType = await worker.fetch(
    new Request('https://kitchen.test/api/decide', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-run-ticket': playTicket },
      body: '{"state":"x"}',
    }),
    env(),
  );
  assert.equal(wrongType.status, 415);
  assert.equal(calls.length, 0, 'no rejected request may reach the model');
});

test('rate limits fail closed and never reach the model', async () => {
  calls.length = 0;
  const denied = { limit: async () => ({ success: false }) };
  const decideDenied = await worker.fetch(
    post('/api/decide', { state: 'x', questions: validQuestions }),
    { ...env(), DECIDE_LIMITER: denied },
  );
  assert.equal(decideDenied.status, 429);

  const sessionDenied = await worker.fetch(
    new Request('https://kitchen.test/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'play' }),
    }),
    { ...env(), SESSION_LIMITER: denied },
  );
  assert.equal(sessionDenied.status, 429);

  const broken = {
    limit: async () => {
      throw new Error('limiter down');
    },
  };
  const brokenLimiter = await worker.fetch(
    post('/api/decide', { state: 'x', questions: validQuestions }),
    { ...env(), DECIDE_LIMITER: broken },
  );
  assert.equal(brokenLimiter.status, 429);
  assert.equal(calls.length, 0);
});

test('verified runs replay the server-issued chain and rank it', async () => {
  const store = memoryRunStore();
  const envWithStore = { ...env(), RUN_STORE: store };
  const decisions = ['fetch_tomato', 'chop', 'fetch_plate', 'plate', 'serve'];
  await store.init(benchSid, 42, RANKED_PROTOCOL);
  for (const id of decisions) await store.append(benchSid, id);
  const response = await worker.fetch(post('/api/runs/finish', {}), envWithStore);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.decisions, decisions.length);
  const expected = runReplayCampaign({ seed: 42, decisions });
  assert.equal(body.result.score, expected.score);
  assert.equal(body.result.clearedLevels, expected.clearedLevels);
  assert.equal(body.result.reachedLevel, expected.reachedLevel);
  assert.equal(body.result.protocol, RANKED_PROTOCOL);

  const board = await worker.fetch(
    new Request('https://kitchen.test/api/leaderboard'),
    envWithStore,
  );
  const listing = await board.json();
  assert.equal(listing.ok, true);
  assert.equal(listing.protocol, RANKED_PROTOCOL);
  assert.equal(listing.board.length, 1);
  assert.equal(listing.board[0].sid, benchSid);
  assert.equal(listing.board[0].score, expected.score);
});

test('verified runs reject a missing store, an unknown run and a protocol mismatch', async () => {
  assert.equal((await worker.fetch(post('/api/runs/finish', {}), env())).status, 503);

  const unknown = memoryRunStore();
  assert.equal(
    (await worker.fetch(post('/api/runs/finish', {}), { ...env(), RUN_STORE: unknown })).status,
    404,
  );

  const stale = memoryRunStore();
  await stale.init(benchSid, 1, 'some-old-protocol');
  assert.equal(
    (await worker.fetch(post('/api/runs/finish', {}), { ...env(), RUN_STORE: stale })).status,
    409,
  );

  assert.equal(
    (await worker.fetch(new Request('https://kitchen.test/api/leaderboard'), env())).status,
    503,
  );
});

test('the run Durable Object stores per-run chains and one sorted board', async () => {
  const storage = {
    map: new Map(),
    async get(key) {
      return this.map.get(key);
    },
    async put(key, value) {
      this.map.set(key, value);
    },
  };
  const store = new GameStore({ storage }, {});
  const call = (path, body, method = 'POST') =>
    store.fetch(
      new Request(`https://do${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      }),
    );
  await call('/init', { sid: 'a', seed: 1, protocol: RANKED_PROTOCOL });
  await call('/init', { sid: 'a', seed: 1, protocol: RANKED_PROTOCOL });
  assert.equal((await (await call('/append', { sid: 'a', choice: 'chop' })).json()).ordinal, 0);
  assert.equal((await (await call('/append', { sid: 'a', choice: 'serve' })).json()).ordinal, 1);
  const finished = await (await call('/finish', { sid: 'a' })).json();
  assert.equal(finished.run.status, 'finished');
  assert.deepEqual(finished.run.decisions, ['chop', 'serve']);
  // A closed run rejects further decisions.
  assert.equal((await call('/append', { sid: 'a', choice: 'serve' })).status, 409);
  const missing = await (await call('/run?sid=missing', undefined, 'GET')).json();
  assert.equal(missing.run, null);
  await call('/board', { sid: 'a', clearedLevels: 5, score: 100, served: 20, at: 1 });
  await call('/board', { sid: 'b', clearedLevels: 7, score: 10, served: 30, at: 2 });
  await call('/board', { sid: 'c', clearedLevels: 5, score: 200, served: 25, at: 3 });
  const board = await (await call('/board', undefined, 'GET')).json();
  assert.deepEqual(
    board.board.map((entry) => entry.sid),
    ['b', 'c', 'a'],
  );
});
