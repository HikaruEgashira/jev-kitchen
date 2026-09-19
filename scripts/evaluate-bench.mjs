import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { compactDecisionState, latencyStats } from '../src/benchmark.js';

const { values } = parseArgs({
  options: {
    repeats: { type: 'string', default: '3' },
    output: { type: 'string', default: '/tmp/jev-context-evaluation.json' },
  },
});
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20)
  throw new Error('repeats must be 1..20');
const corpus = JSON.parse(
  readFileSync(new URL('../test/fixtures/bench-decisions.json', import.meta.url)),
);
for (const fixture of corpus.cases) {
  if (
    !fixture.expected.length ||
    fixture.expected.some((id) => !Object.hasOwn(fixture.questions.next_action.criteria, id))
  )
    throw new Error(`Invalid expected actions: ${fixture.id}`);
}
const endpoint = new URL('/api/bench/decide', process.env.BENCH_ORIGIN ?? 'http://127.0.0.1:8787');
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
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
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
