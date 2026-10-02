import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/**
 * One campaign per model: latency (median, p95) measured first on the fixed
 * decision corpus, then the in-game score campaign. Both go through the same
 * Worker (BENCH_ORIGIN). Writes a markdown report in that order.
 */
const scriptDir = new URL('../', import.meta.url);
const MODEL_NAMES: Record<string, string> = {
  jev: 'Jev (TypeSafe)',
  clef: 'Clef (@cf/cloudflare/clef)',
  'clef-flash': 'Clef Flash (@cf/cloudflare/clef-flash)',
  laya: 'Laya (jev.plenoai.com)',
  laya_jp: 'Laya JP (trained)',
};

const { values } = parseArgs({
  options: {
    models: { type: 'string', default: 'jev,clef,clef-flash' },
    until: { type: 'string', default: '30' },
    repeats: { type: 'string', default: '3' },
    output: { type: 'string', default: '/tmp/jev-bench-report.md' },
    origin: { type: 'string', default: 'http://127.0.0.1:8787' },
    frequency: { type: 'string', default: '3' },
    pace: { type: 'string', default: '400' },
  },
});
const until = Number(values.until);
const repeats = Number(values.repeats);
if (!Number.isInteger(until) || until < 1 || until > 100) throw new Error('until must be 1..100');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20)
  throw new Error('repeats must be 1..20');
const models = values.models
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
for (const id of models) {
  if (!Object.hasOwn(MODEL_NAMES, id))
    throw new Error(`model must be ${Object.keys(MODEL_NAMES).join(', ')}`);
}
const outputUrl = new URL(values.output, import.meta.url);
mkdirSync(new URL('.', outputUrl).pathname, { recursive: true });

function run(script: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync('node', [new URL(script, scriptDir).pathname, ...args], {
    cwd: scriptDir.pathname,
    env: { ...process.env, BENCH_ORIGIN: values.origin },
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status, stdout: result.stdout };
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
};
const p95 = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]);
};

const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const latencyRows: Array<Record<string, unknown>> = [];
const scoreRows: Array<Record<string, unknown>> = [];
let failures = 0;

for (const model of models) {
  const baseName = `jev-bench-${model}.json`;
  const latencyOut = new URL(baseName.replace(/\.json$/, '-latency.json'), outputUrl).pathname;
  console.log(`\n### ${MODEL_NAMES[model]} — latency (corpus)`);
  let latencyStatus = run('scripts/evaluate-bench.ts', [
    '--model',
    model,
    '--repeats',
    String(repeats),
    '--pace',
    values.pace,
    '--output',
    latencyOut,
  ]).status;
  const observations: Array<{ latencyMs: number; correct: boolean }> =
    latencyStatus === 0 ? JSON.parse(readFileSync(latencyOut, 'utf8')).observations : [];
  latencyRows.push({
    model,
    status: latencyStatus === 0 ? 'ok' : 'failed',
    medianMs: median(observations.map((o) => o.latencyMs)),
    p95Ms: p95(observations.map((o) => o.latencyMs)),
    correct: observations.filter((o) => o.correct).length,
    total: observations.length,
  });

  console.log(`### ${MODEL_NAMES[model]} — score (Lv${until} campaign)`);
  const scoreOut = new URL(baseName, outputUrl).pathname;
  const scoreStatus = run('scripts/bench.ts', [
    '--model',
    model,
    '--accelerated',
    '--frequency',
    values.frequency,
    '--until',
    String(until),
    '--output',
    scoreOut,
  ]).status;
  const campaign = scoreStatus === 0 ? JSON.parse(readFileSync(scoreOut, 'utf8')) : null;
  scoreRows.push({
    model,
    status: scoreStatus === 0 ? campaign.status : 'error',
    score: campaign?.score ?? campaign?.finalShift?.score ?? null,
    cleared: campaign?.clearedLevels ?? 0,
    reached: campaign?.reachedLevel ?? 0,
    requests: campaign?.requests ?? 0,
    errors: campaign?.errors ?? 0,
  });
  if ((campaign?.clearedLevels ?? 0) < until) failures++;
}

const lines = [
  `# jev-bench レポート（${new Date().toISOString()}）`,
  '',
  `- リポジトリ: \`${revision}\``,
  `- 対象: ${models.map((id) => `${MODEL_NAMES[id]} (${id})`).join('、')}`,
  `- 実行順: ①固定局面レイテンシ（median・p95）→ ②Lv${until}キャンペーンスコア`,
  `- 接続先: \`${values.origin}\`（frequency ${values.frequency}Hz、corpus pace ${values.pace}ms）`,
  '- 注: ローカルの rate limit（240/min/IP）を下回るよう frequency 3Hz で実施。旧5Hz計測とは条件が異なるが、3モデル間の比較は同一条件。',
  '- score は全プレイ済みシフト（クリア・失敗とも）のスコア合計。同一レベル同士の per-shift 比較とは別物。',
  '',
  '## ① レイテンシ（corpus 往復 ms、小さいほど良い）',
  '',
  '| model | median | p95 | correct/total |',
  '|-------|-------:|----:|--------------:|',
  ...latencyRows.map(
    (r) => `| ${r.model} | ${r.medianMs ?? '—'} | ${r.p95Ms ?? '—'} | ${r.correct}/${r.total} |`,
  ),
  '',
  '## ② スコア（キャンペーン）',
  '',
  '| model | score | cleared | reached | status | requests | errors |',
  '|-------|------:|--------:|--------:|--------|---------:|-------:|',
  ...scoreRows.map(
    (r) =>
      `| ${r.model} | ${r.score ?? '—'} | ${r.cleared} | ${r.reached} | ${r.status} | ${r.requests} | ${r.errors} |`,
  ),
  '',
];
writeFileSync(outputUrl.pathname, lines.join('\n'));
console.log(`\n${outputUrl.pathname} (failures: ${failures})`);
process.exitCode = failures ? 1 : 0;
