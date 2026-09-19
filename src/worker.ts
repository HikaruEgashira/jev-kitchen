/**
 * Thin Jev proxy for the kitchen demo.
 *
 * The client owns the game state and enumerates mechanically-feasible actions.
 * This Worker only: validates the request shape and forwards it to the
 * Workers AI `typesafe/jev` model. No game logic here on purpose.
 */

import {
  clientKey,
  signTicket,
  verifyTicket,
  withinLimit,
  type RateLimiter,
  type Ticket,
} from './session.ts';
import { runReplayCampaign, RANKED_PROTOCOL } from './replay.js';
import { durableRunStore, type BoardEntry, type RunStore } from './run-store.ts';

export { GameStore } from './game-store.ts';

interface AiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<any>;
}

export interface Env {
  AI: AiBinding;
  /** When set, the direct TypeSafe API is used instead of the Workers AI binding. */
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
  /** Server-owned allowlist; URLs and tokens are never accepted from the browser. */
  BENCH_ENDPOINTS?: string;
  /** HMAC secret for run tickets. Unset disables every billed route. */
  TICKET_SECRET?: string;
  /** Per-IP limits for starting a run and for spending a model call. */
  SESSION_LIMITER?: RateLimiter;
  DECIDE_LIMITER?: RateLimiter;
  /** Durable Object namespace for verified runs and the leaderboard. */
  RUNS?: any;
  /** Test/local override for the run store. */
  RUN_STORE?: RunStore;
}

const JEV_MODEL = 'typesafe/jev';
const LLM_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_TYPESAFE_MODEL = 'jev-latest';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 128 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_RUN_DECISIONS = 20_000;
const ACTION_ID = /^[a-z][a-z0-9_]{0,63}$/;

function runStore(env: Env): RunStore | null {
  if (env.RUN_STORE) return env.RUN_STORE;
  if (env.RUNS) return durableRunStore(env.RUNS);
  return null;
}

class BodyTooLargeError extends Error {}

class BodyReadTimeoutError extends Error {}

class UpstreamTimeoutError extends Error {}

class UpstreamFailureError extends Error {}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  timeoutMs = 0,
): Promise<string> {
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          void reader.cancel().catch(() => {});
        }, timeoutMs)
      : undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new BodyReadTimeoutError();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The body is already unusable; preserve the bounded-body error.
        }
        throw new BodyTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
}

async function readJson(request: Request): Promise<{ body?: any; error?: string }> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return { error: 'request body too large' };
  }

  try {
    const text = await readBoundedText(request.body, MAX_REQUEST_BYTES, UPSTREAM_TIMEOUT_MS);
    return { body: JSON.parse(text) };
  } catch (error) {
    return {
      error:
        error instanceof BodyTooLargeError
          ? 'request body too large'
          : error instanceof BodyReadTimeoutError
            ? 'request body timeout'
            : 'invalid JSON',
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function publicFailure(error: unknown): string {
  const timedOut =
    error instanceof UpstreamTimeoutError ||
    error instanceof BodyReadTimeoutError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
  console.error(
    JSON.stringify({
      event: 'upstream_failure',
      kind: timedOut ? 'timeout' : error instanceof UpstreamFailureError ? 'response' : 'request',
    }),
  );
  return timedOut ? 'upstream timeout' : 'upstream unavailable';
}

/**
 * Two routes to the same model.
 *
 *  - `TYPESAFE_API_KEY` set -> TypeSafe's own API (no Cloudflare billing).
 *  - otherwise             -> the Workers AI `typesafe/jev` binding.
 *
 * Workers AI runs third-party models through AI Gateway billing, which fails
 * with `2021: Insufficient AI Gateway credits` on an uncredited account, so the
 * direct API is the working default for this demo.
 */
async function runJev(
  env: Env,
  input: { state: unknown; questions: unknown },
): Promise<{ result: any; model: string | null; via: 'typesafe-api' | 'workers-ai' }> {
  if (env.TYPESAFE_API_KEY) {
    const model = env.TYPESAFE_MODEL ?? DEFAULT_TYPESAFE_MODEL;
    return {
      result: await callEndpoint({ url: TYPESAFE_URL, token: env.TYPESAFE_API_KEY, model }, input),
      model,
      via: 'typesafe-api',
    };
  }
  const raw = await withTimeout(
    Promise.resolve().then(() => env.AI.run(JEV_MODEL, input)),
    UPSTREAM_TIMEOUT_MS,
  );
  assertUpstreamResult(raw);
  return {
    result: raw,
    model: JEV_MODEL,
    via: 'workers-ai',
  };
}

const jevVia = (env: Env): 'typesafe-api' | 'workers-ai' =>
  env.TYPESAFE_API_KEY ? 'typesafe-api' : 'workers-ai';

interface BenchEndpoint {
  name?: string;
  url: string;
  token?: string;
  model?: string;
}

function benchEndpoints(env: Env): Record<string, BenchEndpoint> {
  const entries = JSON.parse(env.BENCH_ENDPOINTS || '{}');
  if (
    !entries ||
    typeof entries !== 'object' ||
    Array.isArray(entries) ||
    Object.keys(entries).length > 20
  )
    throw new Error('Invalid benchmark configuration');
  for (const [id, entry] of Object.entries(entries) as [string, BenchEndpoint][]) {
    if (
      !ACTION_ID.test(id) ||
      id === 'jev' ||
      !entry ||
      typeof entry.url !== 'string' ||
      (entry.name !== undefined && (typeof entry.name !== 'string' || entry.name.length > 80)) ||
      (entry.token !== undefined && typeof entry.token !== 'string') ||
      (entry.model !== undefined && (typeof entry.model !== 'string' || entry.model.length > 100))
    )
      throw new Error('Invalid benchmark configuration');
    const url = new URL(entry.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('Invalid benchmark endpoint');
  }
  return entries;
}

async function callEndpoint(
  endpoint: BenchEndpoint,
  input: { state: unknown; questions: unknown },
): Promise<any> {
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {}),
    },
    body: JSON.stringify({ ...(endpoint.model ? { model: endpoint.model } : {}), ...input }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    redirect: 'manual',
  });
  const text = await readBoundedText(res.body, MAX_UPSTREAM_BYTES, UPSTREAM_TIMEOUT_MS);
  if (!res.ok) throw new UpstreamFailureError();
  try {
    const raw = JSON.parse(text);
    assertUpstreamResult(raw);
    return raw;
  } catch {
    throw new UpstreamFailureError();
  }
}

/**
 * Trust boundary #2: no billed route runs without a rate-limit-passing session.
 * `content-type` is enforced so a cross-origin `text/plain` POST cannot skip the
 * CORS preflight and reach the model.
 */
async function authorize(
  request: Request,
  env: Env,
  mode: Ticket['mode'],
): Promise<{ ticket: Ticket } | { response: Response }> {
  if (!env.TICKET_SECRET)
    return { response: json({ ok: false, error: 'server not configured' }, 503) };
  if (
    (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    return { response: json({ ok: false, error: 'content-type must be application/json' }, 415) };
  if (!(await withinLimit(env.DECIDE_LIMITER, clientKey(request))))
    return { response: json({ ok: false, error: 'rate limited' }, 429) };
  const ticket = await verifyTicket(
    env.TICKET_SECRET,
    request.headers.get('x-run-ticket'),
    Date.now(),
  );
  if (!ticket || ticket.mode !== mode)
    return { response: json({ ok: false, error: 'invalid ticket' }, 401) };
  return { ticket };
}

/** Issue a fresh run ticket. Rate limited per IP; carries the server seed. */
async function session(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!env.TICKET_SECRET) return json({ ok: false, error: 'server not configured' }, 503);
  if (!(await withinLimit(env.SESSION_LIMITER, clientKey(request))))
    return json({ ok: false, error: 'rate limited' }, 429);
  const parsed = await readJson(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const mode = parsed.body?.mode;
  if (mode !== 'play' && mode !== 'bench')
    return json({ ok: false, error: 'mode must be play or bench' }, 400);
  const now = Date.now();
  const ticket: Ticket = {
    sid: crypto.randomUUID(),
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    mode,
    exp: now + SESSION_TTL_MS,
  };
  if (mode === 'bench') {
    const store = runStore(env);
    if (store) await store.init(ticket.sid, ticket.seed, RANKED_PROTOCOL);
  }
  return json({
    ok: true,
    mode,
    seed: ticket.seed,
    expiresAt: ticket.exp,
    ticket: await signTicket(env.TICKET_SECRET, ticket),
    ...(mode === 'bench' ? { ranked: { protocol: RANKED_PROTOCOL } } : {}),
  });
}

async function benchmark(request: Request, env: Env, list: boolean): Promise<Response> {
  if (request.method !== (list ? 'GET' : 'POST'))
    return json({ ok: false, error: 'method not allowed' }, 405);
  let ticket: Ticket | null = null;
  if (!list) {
    const auth = await authorize(request, env, 'bench');
    if ('response' in auth) return auth.response;
    ticket = auth.ticket;
  }
  let endpoints;
  try {
    endpoints = benchEndpoints(env);
  } catch {
    return json({ ok: false, error: 'invalid benchmark configuration' }, 503);
  }
  if (list)
    return json({
      models: [
        { id: 'jev', name: 'Jev' },
        ...Object.entries(endpoints).map(([id, endpoint]) => ({ id, name: endpoint.name || id })),
      ],
    });
  const parsed = await readJson(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const body = parsed.body;
  const invalid = validate(body);
  if (invalid) return json({ ok: false, error: invalid }, 400);
  if (
    typeof body.modelId !== 'string' ||
    (body.modelId !== 'jev' && !Object.hasOwn(endpoints, body.modelId))
  )
    return json({ ok: false, error: 'unknown model' }, 400);
  if (Object.keys(body.questions).length !== 1 || body.questions.next_action?.type !== 'choice')
    return json({ ok: false, error: 'next_action choice required' }, 400);
  const t0 = Date.now();
  try {
    const input = { state: body.state, questions: body.questions };
    const { result, via } =
      body.modelId === 'jev'
        ? await runJev(env, input)
        : { result: await callEndpoint(endpoints[body.modelId], input), via: 'decision-endpoint' };
    const projected = projectDecision(result);
    if (
      !Object.hasOwn(
        body.questions.next_action.criteria,
        projected.answers.next_action.choice as string,
      )
    )
      throw new UpstreamFailureError();
    // Record the server-issued choice so finish() replays the real chain.
    const store = runStore(env);
    if (store && ticket)
      await store
        .append(ticket.sid, projected.answers.next_action.choice as string)
        .catch(() => {});
    return json({
      ok: true,
      engine: body.modelId,
      via,
      upstreamMs: Date.now() - t0,
      result: projected,
    });
  } catch (error) {
    return json({ ok: false, error: publicFailure(error) }, 502);
  }
}

/** Re-simulate the server-issued decision chain and publish a verified score. */
async function finishRun(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  const auth = await authorize(request, env, 'bench');
  if ('response' in auth) return auth.response;
  const store = runStore(env);
  if (!store) return json({ ok: false, error: 'run store unavailable' }, 503);
  const run = await store.finish(auth.ticket.sid);
  if (!run) return json({ ok: false, error: 'unknown run' }, 404);
  if (run.protocol !== RANKED_PROTOCOL) return json({ ok: false, error: 'protocol mismatch' }, 409);
  if (
    !Array.isArray(run.decisions) ||
    run.decisions.length > MAX_RUN_DECISIONS ||
    run.decisions.some((id) => typeof id !== 'string' || !ACTION_ID.test(id))
  )
    return json({ ok: false, error: 'invalid run log' }, 409);
  const replayed = runReplayCampaign({ seed: run.seed, decisions: run.decisions });
  const entry: BoardEntry = {
    sid: auth.ticket.sid,
    protocol: replayed.protocol,
    score: replayed.score,
    served: replayed.served,
    clearedLevels: replayed.clearedLevels,
    reachedLevel: replayed.reachedLevel,
    completed: replayed.completed,
    truncated: replayed.truncated || replayed.diverged,
    at: Date.now(),
  };
  await store.submit(entry);
  return json({ ok: true, result: entry, decisions: run.decisions.length });
}

async function leaderboard(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
  const store = runStore(env);
  if (!store) return json({ ok: false, error: 'run store unavailable' }, 503);
  return json({
    ok: true,
    protocol: RANKED_PROTOCOL,
    board: await store.board(),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case '/api/session':
        return session(request, env);
      case '/api/bench/models':
        return benchmark(request, env, true);
      case '/api/bench/decide':
        return benchmark(request, env, false);
      case '/api/runs/finish':
        return finishRun(request, env);
      case '/api/leaderboard':
        return leaderboard(request, env);
      case '/api/health':
        return health(request, env);
      case '/api/decide':
        return decide(request, env);
      case '/api/decide-llm':
        return decideLlm(request, env);
      default:
        return json({ ok: false, error: 'not found' }, 404);
    }
  },
};

/**
 * Configuration probe only. Deliberately does not call the model: a GET must be
 * side-effect free, and the previous version let any page burn one Jev call via
 * a cross-origin `no-cors` request.
 */
async function health(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
  return json({
    ok: true,
    engine: 'jev',
    via: jevVia(env),
    model: env.TYPESAFE_API_KEY ? (env.TYPESAFE_MODEL ?? DEFAULT_TYPESAFE_MODEL) : JEV_MODEL,
    configured: {
      sessions: Boolean(env.TICKET_SECRET),
      rateLimit: Boolean(env.DECIDE_LIMITER),
    },
  });
}

async function decide(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  const auth = await authorize(request, env, 'play');
  if ('response' in auth) return auth.response;

  const parsed = await readJson(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const body = parsed.body;

  const invalid = validate(body);
  if (invalid) return json({ ok: false, error: invalid }, 400);

  const t0 = Date.now();
  try {
    const { result, via } = await runJev(env, {
      state: body.state,
      questions: body.questions,
    });
    return json({
      ok: true,
      engine: 'jev',
      via,
      upstreamMs: Date.now() - t0,
      result: projectDecision(result),
    });
  } catch (e) {
    return json(
      {
        ok: false,
        engine: 'jev',
        via: jevVia(env),
        upstreamMs: Date.now() - t0,
        error: publicFailure(e),
      },
      502,
    );
  }
}

/**
 * Latency/quality baseline: a general LLM given the same state and the same
 * action list. Deliberately the weakest fair comparator, not a strawman.
 */
async function decideLlm(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  const auth = await authorize(request, env, 'play');
  if ('response' in auth) return auth.response;

  const parsed = await readJson(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const body = parsed.body;

  if (body?.state == null) return json({ ok: false, error: 'state required' }, 400);
  const stateError = validateState(body.state);
  if (stateError) return json({ ok: false, error: stateError }, 400);
  const cands = body?.candidates;
  if (!Array.isArray(cands) || cands.length < 1 || cands.length > 255) {
    return json({ ok: false, error: 'candidates must be an array of 1..255' }, 400);
  }

  if (body.model !== undefined && body.model !== LLM_MODEL) {
    return json({ ok: false, error: 'unsupported model' }, 400);
  }
  for (const candidate of cands) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      typeof candidate.id !== 'string' ||
      !ACTION_ID.test(candidate.id) ||
      typeof candidate.label !== 'string' ||
      candidate.label.length > 500
    ) {
      return json({ ok: false, error: 'candidate id and label are invalid' }, 400);
    }
  }

  const ids: string[] = cands.map((c: any) => c.id);
  const list = cands.map((c: any) => `- ${c.id}: ${c.label}`).join('\n');
  const prompt = [
    'You are the sous-chef AI sharing one small kitchen with a human cook.',
    'Choose the single next action id for yourself that best follows the collaboration policy',
    'in the state and complements (does not duplicate) what the human is doing.',
    'Reply with ONLY the action id, nothing else.',
    '',
    `State:\n${JSON.stringify(body.state, null, 2)}`,
    '',
    `Actions:\n${list}`,
  ].join('\n');

  const t0 = Date.now();
  try {
    const out: any = await withTimeout(
      Promise.resolve().then(() =>
        env.AI.run(body.model ?? LLM_MODEL, {
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 24,
        }),
      ),
      UPSTREAM_TIMEOUT_MS,
    );
    const text = String(out?.response ?? '');
    const choice =
      ids.find((id) =>
        new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text),
      ) ?? null;
    return json({
      ok: true,
      engine: 'llm',
      upstreamMs: Date.now() - t0,
      result: { answers: { next_action: { type: 'choice', choice } } },
    });
  } catch (e) {
    return json(
      { ok: false, engine: 'llm', upstreamMs: Date.now() - t0, error: publicFailure(e) },
      502,
    );
  }
}

/** Trust boundary: the browser is untrusted, so cap everything before billing the model. */
function validate(body: any): string | null {
  if (!body || typeof body !== 'object') return 'body must be an object';

  const { state, questions } = body;
  const stateError = validateState(state);
  if (stateError) return stateError;

  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    return 'questions must be an object';
  }
  const keys = Object.keys(questions);
  if (keys.length < 1 || keys.length > 8) return 'questions must have 1..8 entries';

  for (const key of keys) {
    const q = questions[key];
    if (!q || typeof q !== 'object') return `question ${key} must be an object`;
    if (!['noul', 'choice', 'score'].includes(q.type)) {
      return `question ${key} has invalid type`;
    }
    if (q.type === 'choice') {
      if (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) {
        return `question ${key} choice criteria must be an object`;
      }
      const n = Object.keys(q.criteria).length;
      if (n < 2 || n > 255) return `question ${key} choice criteria must have 2..255 options`;
      for (const [choice, label] of Object.entries(q.criteria)) {
        if (!ACTION_ID.test(choice) || typeof label !== 'string' || label.length > 500) {
          return `question ${key} choice criteria is invalid`;
        }
      }
    }
    if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10) {
        return `question ${key} score criteria must be an array of 2..10`;
      }
    }
  }
  return null;
}

function validateState(state: any): string | null {
  if (state === null || (typeof state !== 'string' && typeof state !== 'object')) {
    return 'state must be a string, object or array';
  }
  if (typeof state === 'string' && state.length > 100_000) return 'state too long';
  return null;
}

function projectDecision(raw: any): { answers: { next_action: Record<string, unknown> } } {
  const answer = raw?.answers?.next_action;
  if (!answer || typeof answer.choice !== 'string' || !ACTION_ID.test(answer.choice)) {
    throw new UpstreamFailureError();
  }

  const nextAction: Record<string, unknown> = { type: 'choice', choice: answer.choice };
  if (typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)) {
    nextAction.confidence = answer.confidence;
  }
  return { answers: { next_action: nextAction } };
}

function assertUpstreamResult(raw: any): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'error' in raw) {
    throw new UpstreamFailureError();
  }
}
