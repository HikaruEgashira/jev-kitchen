import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { compactDecisionState, latencyStats } from '../src/benchmark.ts';
import { apiFetch } from '../src/api-client.ts';
import type { DecisionInput } from '../src/types.ts';

interface BenchFixture {
  id: string;
  split: string;
  state: DecisionInput;
  questions: { next_action: { criteria: Record<string, unknown>; [key: string]: unknown } };
  expected: string[];
}

interface BenchCorpus {
  sourceRevision: string;
  cases: BenchFixture[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The corpus is checked in, so only the fields this script reads are validated.
function readCorpus(path: URL): BenchCorpus {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    !isRecord(parsed) ||
    typeof parsed.sourceRevision !== 'string' ||
    !Array.isArray(parsed.cases)
  )
    throw new Error('Invalid bench decision corpus');
  for (const entry of parsed.cases) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.split !== 'string' ||
      !Array.isArray(entry.expected) ||
      !entry.expected.every((id) => typeof id === 'string') ||
      !isRecord(entry.state) ||
      !isRecord(entry.questions) ||
      !isRecord(entry.questions.next_action) ||
      !isRecord(entry.questions.next_action.criteria)
    )
      throw new Error('Invalid bench decision corpus');
  }
  return parsed as unknown as BenchCorpus;
}

const { values } = parseArgs({
  options: {
    repeats: { type: 'string', default: '3' },
    output: { type: 'string', default: '/tmp/jev-context-evaluation.json' },
  },
});
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20)
  throw new Error('repeats must be 1..20');
const corpus = readCorpus(new URL('../test/fixtures/bench-decisions.json', import.meta.url));
for (const fixture of corpus.cases) {
  if (
    !fixture.expected.length ||
    fixture.expected.some((id) => !Object.hasOwn(fixture.questions.next_action.criteria, id))
  )
    throw new Error(`Invalid expected actions: ${fixture.id}`);
}
const origin = process.env.BENCH_ORIGIN ?? 'http://127.0.0.1:8787';
const request = globalThis.fetch;
globalThis.fetch = (path, options) =>
  request(typeof path === 'string' ? new URL(path, origin) : path, options);
const observations = [];
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const fixture of corpus.cases) {
    // Alternate order so connection warmup does not always favor one variant.
    for (const variant of repeat % 2 ? ['compact', 'full'] : ['full', 'compact']) {
      const body = JSON.stringify({
        modelId: 'jev',
        state: variant === 'compact' ? compactDecisionState(fixture.state) : fixture.state,
        questions: fixture.questions,
      });
      const started = performance.now();
      const response = await apiFetch('/api/bench/decide', body, 'bench', {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Decision endpoint: HTTP ${response.status}`);
      const data = await response.json();
      const answer = data.result?.answers?.next_action;
      if (!data.ok || !Object.hasOwn(fixture.questions.next_action.criteria, answer?.choice))
        throw new Error('Invalid model decision');
      observations.push({
        id: fixture.id,
        split: fixture.split,
        repeat,
        variant,
        choice: answer.choice,
        correct: fixture.expected.includes(answer.choice),
        confidence: Number.isFinite(answer.confidence) ? answer.confidence : null,
        candidateCount: Object.keys(fixture.questions.next_action.criteria).length,
        bytes: Buffer.byteLength(body),
        latencyMs: Math.round(performance.now() - started),
      });
    }
  }
}
const summaries = [];
for (const split of ['calibration', 'holdout']) {
  for (const variant of ['full', 'compact']) {
    const rows = observations.filter((row) => row.split === split && row.variant === variant);
    summaries.push({
      split,
      variant,
      correct: rows.filter((row) => row.correct).length,
      total: rows.length,
      meanBytes: Math.round(rows.reduce((sum, row) => sum + row.bytes, 0) / rows.length),
      ...latencyStats(rows.map((row) => row.latencyMs)),
    });
  }
}
const result = {
  sourceRevision: corpus.sourceRevision,
  model: 'jev',
  repeats,
  summaries,
  observations,
};
writeFileSync(values.output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(summaries, null, 2));
console.log(values.output);
