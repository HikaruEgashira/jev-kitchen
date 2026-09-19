import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { useKitchen, tick } from '../src/game.js';
import { runBenchmark, stopBenchmark, useBenchmark, kitchenHasWork } from '../src/benchmark.js';

const { values } = parseArgs({
  options: {
    until: { type: 'string', default: '30' },
    output: { type: 'string', default: '/tmp/jev-bench.json' },
    accelerated: { type: 'boolean', default: false },
  },
});
const until = Number(values.until);
if (!Number.isInteger(until) || until < 1 || until > 100) throw new Error('until must be 1..100');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const origin = new URL(process.env.BENCH_ORIGIN ?? 'http://127.0.0.1:8787');
const request = globalThis.fetch;
let requesting = false;
globalThis.fetch = async (path, options) => {
  requesting = true;
  try {
    return await request(new URL(path, origin), options);
  } finally {
    requesting = false;
  }
};
useKitchen.setState({ ready: true, sound: false });
let last = performance.now();
// Same real clock, tick, decisions and transactions as /bench; no rendering.
const clock = setInterval(() => {
  const now = performance.now();
  tick((now - last) / 1000);
  last = now;
  // Calibration skips wall-clock travel, never model latency. Every movement,
  // partner decision and cooking timer still advances through the same tick.
  if (values.accelerated && !requesting) {
    const { game } = useKitchen.getState();
    const intent = game.human.intent;
    const exhausted = !kitchenHasWork(game);
    while (
      useKitchen.getState().phase === 'playing' &&
      (exhausted || (intent && game.human.intent === intent))
    )
      tick(1 / 60);
  }
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
    runtime: values.accelerated
      ? 'node, accelerated travel and waits, real response latency, 60 Hz game tick, no renderer'
      : 'node, real time, 60 Hz tick, no renderer',
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
