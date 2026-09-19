import { create } from 'zustand';
import { useKitchen, startBenchmark, benchmarkAction, nextShift, togglePause } from './game.js';
import { buildCandidates, buildQuestions, observe, MAX_LEVEL, STOCK_PRICE } from './model.js';
import { STAFF } from './staff.js';
import { preparation, purchase } from './ui.js';

export const BENCH_PROTOCOL = 'jev-bench-v1';
export const useBenchmark = create(() => ({
  running: false,
  action: '',
  log: [],
  elapsedMs: 0,
  requests: 0,
  results: [],
}));
let controller;
const sleep = () => new Promise((resolve) => setTimeout(resolve, 50));

export function preparationCandidates(state, plan) {
  const g = state.game;
  const candidates = [{ id: 'wait', label: '準備内容を維持する' }];
  if (plan.selected)
    candidates.push({ id: 'skip_hiring', label: '採用を取り消す', selected: null });
  for (const id of state.applicants) {
    if (id !== plan.selected)
      candidates.push({
        id: `hire_${id}`,
        label: `${STAFF[id].name}を採用予定にする（${STAFF[id].cost}コイン）`,
        selected: id,
      });
  }
  for (const id of new Set([...g.hired, ...(plan.selected ? [plan.selected] : [])])) {
    if (id !== plan.assigned)
      candidates.push({
        id: `assign_${id}`,
        label: `${STAFF[id].name}を次の相棒にする`,
        assigned: id,
      });
  }
  for (let quantity = 0; quantity <= 99; quantity++) {
    if (quantity !== plan.quantity)
      candidates.push({
        id: `stock_${quantity}`,
        label: `トマトを${quantity}個仕入れる予定にする（${quantity * STOCK_PRICE}コイン）`,
        quantity,
      });
  }
  if (!purchase(g, plan).error)
    candidates.push({ id: 'open_shift', label: '採用・配置・仕入れを確定し、次の営業を始める' });
  return candidates;
}

function prepare(candidate, plan, g) {
  if (candidate.id === 'open_shift') return nextShift(plan.selected, plan.quantity, plan.assigned);
  if ('selected' in candidate) {
    plan.selected = candidate.selected;
    plan.assigned =
      candidate.selected ?? (g.hired.includes(plan.assigned) ? plan.assigned : g.staffId);
  }
  if ('assigned' in candidate) plan.assigned = candidate.assigned;
  if ('quantity' in candidate) plan.quantity = candidate.quantity;
  return true;
}

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

export async function runBenchmark({ model, frequency = 5, maxRequests = 1000 }) {
  if (useBenchmark.getState().running || !useKitchen.getState().ready) return;
  if (
    !model ||
    typeof model.id !== 'string' ||
    typeof model.name !== 'string' ||
    !Number.isFinite(frequency) ||
    frequency < 0.1 ||
    frequency > 10 ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 10000
  )
    throw new Error('実行条件が不正です');
  const session = new AbortController();
  let clock;
  controller = session;
  useBenchmark.setState({ running: true, action: '', log: [], elapsedMs: 0, requests: 0 });
  try {
    startBenchmark();
    const started = performance.now();
    clock = setInterval(
      () => useBenchmark.setState({ elapsedMs: performance.now() - started }),
      100,
    );
    const result = {
      protocol: BENCH_PROTOCOL,
      revision: import.meta.env?.VITE_COMMIT_SHA ?? 'development',
      model: { id: model.id, name: model.name },
      startedAt: new Date().toISOString(),
      conditions: {
        frequency,
        maxRequests,
        partner: 'rule',
        initialStaff: 'helper',
        shiftSeconds: 90,
        playerDash: true,
        hiring: true,
      },
      status: 'running',
      levels: [],
      requests: 0,
      staleResponses: 0,
      errors: 0,
      decisions: [],
    };
    const latencies = [];
    let nextCallAt = 0;
    let plan;
    let planningGame;
    try {
      while (true) {
        session.signal.throwIfAborted();
        const state = useKitchen.getState();
        const g = state.game;
        if (state.phase === 'finished') {
          if (result.levels.at(-1)?.level !== g.level)
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
              staffId: g.staffId,
              applicants: [...state.applicants],
            });
          if (!state.cleared || g.level >= MAX_LEVEL) {
            result.status = state.cleared ? 'completed' : 'failed';
            break;
          }
          if (planningGame !== g) {
            plan = preparation(g);
            planningGame = g;
          }
        }
        if (!['playing', 'finished'].includes(state.phase) || !state.ready)
          throw new Error('ゲームが中断されました');
        if (result.requests >= maxRequests) {
          if (state.phase === 'playing' && g.human.intent) {
            await sleep();
            continue;
          }
          result.status = 'budget';
          break;
        }
        if (performance.now() < nextCallAt) {
          await sleep();
          continue;
        }
        const preparing = state.phase === 'finished';
        const candidates = preparing
          ? preparationCandidates(state, plan)
          : buildCandidates(g, 'human');
        if (candidates.length === 1) {
          if (preparing) prepare(candidates[0], plan, g);
          else benchmarkAction(candidates[0]);
          await sleep();
          continue;
        }
        const requestStart = performance.now();
        nextCallAt = requestStart + 1000 / frequency;
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
                phase: preparing ? 'preparation' : 'playing',
                player_intent: g.human.intent?.id ?? null,
                dash_ready_in_ms: Math.max(0, g.human.dashReadyAt - g.time),
                cooking: Object.fromEntries(
                  ['board', 'pot', 'grill'].map((id) => {
                    const station = g.stations[id];
                    return [
                      id,
                      {
                        remaining_ms: Math.max(0, station.busyUntil - g.time),
                        progress: station.duration
                          ? (g.time - station.startedAt) / station.duration
                          : null,
                        boosted: station.boosted,
                      },
                    ];
                  }),
                ),
                ...(preparing
                  ? {
                      preparation: {
                        selected: plan.selected,
                        assigned: plan.assigned,
                        quantity: plan.quantity,
                        bill: purchase(g, plan),
                        stock_price: STOCK_PRICE,
                        applicants: state.applicants.map((id) => ({ id, ...STAFF[id] })),
                        roster: g.hired.map((id) => ({ id, ...STAFF[id] })),
                      },
                    }
                  : {}),
                partner_intent: g.ai.intent?.id ?? null,
                position: { human: { x: g.human.x, y: g.human.y }, ai: { x: g.ai.x, y: g.ai.y } },
              },
              questions: preparing
                ? {
                    next_action: {
                      type: 'choice',
                      instructions:
                        'Prepare the next shift. You may hire one applicant, assign any hired partner, and choose 0..99 tomatoes to buy. Choices edit a pending plan; open_shift commits it and starts the next level. Fix bill.error before opening. Choose a partner and sufficient stock within your cash budget.',
                      criteria: Object.fromEntries(candidates.map((c) => [c.id, c.label])),
                    },
                  }
                : buildQuestions(candidates, 'human'),
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
          current.game === g &&
          current.phase === state.phase &&
          (preparing ? prepare(selected, plan, g) : benchmarkAction(selected));
        if (!applied) result.staleResponses++;
        result.decisions.push({
          level: g.level,
          phase: preparing ? 'preparation' : 'playing',
          atMs: Math.round(g.time),
          action: selected.id,
          applied,
          latencyMs: Math.round(latencies.at(-1)),
          via: data.via,
        });
        const action = applied ? selected.label : '状況が変わったため再判断';
        useBenchmark.setState((state) => ({
          action,
          log: [...state.log.slice(-3), { call: result.requests, action }],
        }));
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
  } finally {
    clearInterval(clock);
    if (controller === session) controller = null;
    useBenchmark.setState({ running: false });
  }
}
