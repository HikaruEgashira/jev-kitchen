import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { useKitchen, tick } from '../src/game.js';
import { runBenchmark, stopBenchmark, useBenchmark } from '../src/benchmark.js';

const { values } = parseArgs({
  options: {
    until: { type: 'string', default: '30' },
    output: { type: 'string', default: '/tmp/jev-bench.json' },
  },
});
const until = Number(values.until);
if (!Number.isInteger(until) || until < 1 || until > 100) throw new Error('until must be 1..100');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const origin = new URL(process.env.BENCH_ORIGIN ?? 'http://127.0.0.1:8787');
const request = globalThis.fetch;
globalThis.fetch = (path, options) => request(new URL(path, origin), options);
useKitchen.setState({ ready: true, sound: false });
let last = performance.now();
// Same real clock, tick, decisions and transactions as /bench; no rendering.
const clock = setInterval(() => {
  const now = performance.now();
  tick((now - last) / 1000);
  last = now;
}, 1000 / 60);
let reported = 0;
const unsubscribe = useBenchmark.subscribe(({ splits }) => {
  if (splits.length === reported) return;
  reported = splits.length;
  console.log(JSON.stringify(splits.at(-1)));
  if (splits.at(-1).level >= until) stopBenchmark(`Lv${until} verification complete`);
});
process.on('SIGINT', () => stopBenchmark('Interrupted'));
try {
  await runBenchmark({ model: { id: 'jev', name: 'Jev' }, maxRequests: 10000 });
  const result = useBenchmark.getState().results.at(-1);
  const artifact = {
    ...result,
    revision,
    dirty,
    runtime: 'node, real time, 60 Hz tick, no renderer',
    targetLevel: until,
  };
  writeFileSync(values.output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `${result.status}: ${result.clearedLevels} levels, ${result.requests} calls; ${values.output}`,
  );
  process.exitCode = result.clearedLevels >= until ? 0 : 1;
} finally {
  clearInterval(clock);
  unsubscribe();
}
