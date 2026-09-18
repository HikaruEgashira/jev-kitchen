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
}

const JEV_MODEL = 'typesafe/jev';
const LLM_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case '/api/health':
        return health(env);
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
async function health(env: Env): Promise<Response> {
  const t0 = Date.now();
  try {
    const result = await env.AI.run(JEV_MODEL, {
      state: 'A cook is chopping a tomato in a small kitchen.',
      questions: {
        ok: { type: 'noul', instructions: 'Is a cook chopping a tomato?' },
      },
    });
    return json({
      ok: true,
      engine: 'jev',
      model: result?.model ?? null,
      upstreamMs: Date.now() - t0,
      answers: result?.answers ?? null,
      usage: result?.usage ?? null,
    });
  } catch (e) {
    return json(
      { ok: false, engine: 'jev', upstreamMs: Date.now() - t0, error: errMessage(e) },
      502,
    );
  }
}

async function decide(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400);
  }

  const invalid = validate(body);
  if (invalid) return json({ ok: false, error: invalid }, 400);

  const t0 = Date.now();
  try {
    const result = await env.AI.run(JEV_MODEL, {
      state: body.state,
      questions: body.questions,
    });
    return json({ ok: true, engine: 'jev', upstreamMs: Date.now() - t0, result });
  } catch (e) {
    return json(
      { ok: false, engine: 'jev', upstreamMs: Date.now() - t0, error: errMessage(e) },
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

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400);
  }

  if (body?.state == null) return json({ ok: false, error: 'state required' }, 400);
  const cands = body?.candidates;
  if (!Array.isArray(cands) || cands.length < 1 || cands.length > 255) {
    return json({ ok: false, error: 'candidates must be an array of 1..255' }, 400);
  }

  const ids: string[] = cands.map((c: any) => String(c.id));
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
    const out: any = await env.AI.run(body.model ?? LLM_MODEL, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 24,
    });
    const text = String(out?.response ?? '');
    const choice =
      ids.find((id) => new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) ??
      null;
    return json({
      ok: true,
      engine: 'llm',
      upstreamMs: Date.now() - t0,
      result: { answers: { next_action: { type: 'choice', choice } } },
      raw: text.slice(0, 200),
    });
  } catch (e) {
    return json(
      { ok: false, engine: 'llm', upstreamMs: Date.now() - t0, error: errMessage(e) },
      502,
    );
  }
}

/** Trust boundary: the browser is untrusted, so cap everything before billing the model. */
function validate(body: any): string | null {
  if (!body || typeof body !== 'object') return 'body must be an object';

  const { state, questions } = body;
  if (state === null || (typeof state !== 'string' && typeof state !== 'object')) {
    return 'state must be a string, object or array';
  }
  if (typeof state === 'string' && state.length > 100_000) return 'state too long';

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
    }
    if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10) {
        return `question ${key} score criteria must be an array of 2..10`;
      }
    }
  }
  return null;
}
