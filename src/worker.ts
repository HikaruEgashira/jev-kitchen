/**
 * Thin Jev proxy for the kitchen demo.
 *
 * The client owns the game state and enumerates mechanically-feasible actions.
 * This Worker only: validates the request shape and forwards it to the
 * Workers AI `typesafe/jev` model. No game logic here on purpose.
 */

interface AiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<any>;
}

export interface Env {
  AI: AiBinding;
  /** When set, the direct TypeSafe API is used instead of the Workers AI binding. */
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
}

const JEV_MODEL = 'typesafe/jev';
const LLM_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_TYPESAFE_MODEL = 'jev-latest';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 128 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;
const ACTION_ID = /^[a-z][a-z0-9_]{0,63}$/;

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
    const res = await fetch(TYPESAFE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        state: input.state,
        questions: input.questions,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await readBoundedText(res.body, MAX_UPSTREAM_BYTES, UPSTREAM_TIMEOUT_MS);
    if (!res.ok) throw new UpstreamFailureError();
    try {
      const raw = JSON.parse(text);
      assertUpstreamResult(raw);
      return {
        result: raw,
        model,
        via: 'typesafe-api',
      };
    } catch {
      throw new UpstreamFailureError();
    }
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    switch (pathname) {
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

/** One real Jev call so the venue can measure model latency before the demo. */
async function health(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);

  const t0 = Date.now();
  try {
    const { result, model, via } = await runJev(env, {
      state: 'A cook is chopping a tomato in a small kitchen.',
      questions: {
        ok: { type: 'noul', instructions: 'Is a cook chopping a tomato?' },
      },
    });
    const answer = result?.answers?.ok;
    if (
      answer?.type !== 'noul' ||
      !Number.isFinite(answer.noul) ||
      answer.noul < 0 ||
      answer.noul > 1
    ) {
      throw new UpstreamFailureError();
    }
    return json({
      ok: true,
      engine: 'jev',
      via,
      model,
      upstreamMs: Date.now() - t0,
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

async function decide(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

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
