import { create } from 'zustand';
import { useKitchen, startBenchmark, benchmarkAction, nextShift, togglePause } from './game.js';
import { buildCandidates, buildQuestions, observe } from './model.js';

export const BENCH_PROTOCOL = 'jev-bench-v1';
export const useBenchmark = create(() => ({
  running: false,
  attempt: 0,
  action: '',
  requests: 0,
  results: [],
}));
let controller;
const sleep = () => new Promise((resolve) => setTimeout(resolve, 50));

export function latencyStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    meanMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
    p95Ms: sorted.length ? Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]) : null,
  };
}

export function stopBenchmark(reason = '停止しました') {
  controller?.abort(new Error(reason));
  if (useKitchen.getState().phase === 'playing') togglePause();
}

export async function runBenchmark({ model, attempts = 1, maxLevel = 100, maxRequests = 1000 }) {
  if (useBenchmark.getState().running || !useKitchen.getState().ready) return;
  if (
    !model ||
    typeof model.id !== 'string' ||
    typeof model.name !== 'string' ||
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 5 ||
    !Number.isInteger(maxLevel) ||
    maxLevel < 1 ||
    maxLevel > 100 ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 10000
  )
    throw new Error('実行条件が不正です');
  const session = new AbortController();
  controller = session;
  useBenchmark.setState({ running: true, action: '', requests: 0 });
  try {
    for (let attempt = 1; attempt <= attempts && !session.signal.aborted; attempt++) {
      startBenchmark();
      useBenchmark.setState({ attempt, requests: 0 });
      const started = performance.now();
      const result = {
        protocol: BENCH_PROTOCOL,
        revision: import.meta.env?.VITE_COMMIT_SHA ?? 'development',
        model: { id: model.id, name: model.name },
        startedAt: new Date().toISOString(),
        conditions: {
          maxLevel,
          maxRequests,
          partner: 'helper/rule',
          shiftSeconds: 90,
          playerDash: false,
          hiring: false,
        },
        status: 'running',
        levels: [],
        requests: 0,
        staleResponses: 0,
        errors: 0,
        decisions: [],
      };
      const latencies = [];
      try {
        while (true) {
          session.signal.throwIfAborted();
          const state = useKitchen.getState();
          const g = state.game;
          if (state.phase === 'finished') {
            result.levels.push({
              level: g.level,
              cleared: state.cleared,
              served: g.served,
              playerServed: g.human.served,
              partnerServed: g.ai.served,
              quota: g.quota,
              score: g.score,
              missed: g.missed,
              burned: g.burned,
            });
            if (!state.cleared || g.level >= maxLevel) {
              result.status = state.cleared ? 'completed' : 'failed';
              break;
            }
            // All models keep the same helper and buy the next quota plus two tomatoes.
            if (!nextShift(null)) throw new Error('次の営業の仕入れ資金が不足しました');
            continue;
          }
          if (state.phase !== 'playing' || !state.ready) throw new Error('ゲームが中断されました');
          if (g.human.intent) {
            await sleep();
            continue;
          }
          if (result.requests >= maxRequests) {
            result.status = 'budget';
            break;
          }
          const candidates = buildCandidates(g, 'human');
          if (candidates.length === 1) {
            benchmarkAction(candidates[0]);
            await sleep();
            continue;
          }
          const requestStart = performance.now();
          result.requests++;
          useBenchmark.setState({ requests: result.requests, action: '判断中…' });
          let data;
          try {
            const response = await fetch('/api/bench/decide', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              signal: AbortSignal.any([session.signal, AbortSignal.timeout(10000)]),
              body: JSON.stringify({
                modelId: model.id,
                state: {
                  ...observe(g, ''),
                  controlled_actor: 'human',
                  partner_intent: g.ai.intent?.id ?? null,
                  position: { human: { x: g.human.x, y: g.human.y }, ai: { x: g.ai.x, y: g.ai.y } },
                },
                questions: buildQuestions(candidates, 'human'),
              }),
            });
            if (!response.ok) throw new Error(`Decision endpoint: HTTP ${response.status}`);
            data = await response.json();
            if (!data.ok) throw new Error('モデルが判断を返しませんでした');
          } finally {
            latencies.push(performance.now() - requestStart);
          }
          session.signal.throwIfAborted();
          const selected = candidates.find(
            ({ id }) => id === data.result?.answers?.next_action?.choice,
          );
          if (!selected) throw new Error('モデルが候補外の行動を返しました');
          const current = useKitchen.getState();
          const applied =
            current.game === g && current.phase === 'playing' && benchmarkAction(selected);
          if (!applied) result.staleResponses++;
          result.decisions.push({
            level: g.level,
            atMs: Math.round(g.time),
            action: selected.id,
            applied,
            latencyMs: Math.round(latencies.at(-1)),
            via: data.via,
          });
          useBenchmark.setState({ action: applied ? selected.label : '状況が変わったため再判断' });
          await sleep();
        }
      } catch (error) {
        result.status = session.signal.aborted ? 'stopped' : 'error';
        result.error = session.signal.aborted ? session.signal.reason.message : error.message;
        if (!session.signal.aborted) result.errors++;
      }
      const g = useKitchen.getState().game;
      Object.assign(result, latencyStats(latencies), {
        reachedLevel: g.level,
        clearedLevels: result.levels.filter((level) => level.cleared).length,
        wallMs: Math.round(performance.now() - started),
        finalShift: {
          level: g.level,
          elapsedMs: Math.round(g.time),
          served: g.served,
          playerServed: g.human.served,
          partnerServed: g.ai.served,
          quota: g.quota,
          score: g.score,
        },
      });
      if (useKitchen.getState().phase === 'playing') togglePause();
      useBenchmark.setState((state) => ({ results: [...state.results, result] }));
      // An endpoint error needs an operator fix, not repeated billable attempts.
      if (result.status === 'error') break;
    }
  } finally {
    if (controller === session) controller = null;
    useBenchmark.setState({ running: false });
  }
}
