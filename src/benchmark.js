import { create } from 'zustand';
import {
  useKitchen,
  startBenchmark,
  benchmarkAction,
  nextShift,
  togglePause,
  setMenuOpen,
} from './game.js';
import {
  activeStationIds,
  buildCandidates,
  buildQuestions,
  observe,
  MAX_LEVEL,
  STOCK_PRICE,
  levelConfig,
  RECIPES,
  recommendedStock,
} from './model.js';
import { STAFF, nextStaffState, payroll } from './staff.js';
import { EQUIPMENT, quoteEquipment } from './equipment.js';
import { VITAMINS, quoteVitamins } from './training.js';
import { preparation, purchase, screenContext } from './ui.js';

export const BENCH_PROTOCOL = 'jev-bench-v2';

// Single source of truth for preparation parity. Every action the human
// preparation sheet can render (see `screen()`) must be classified here: either
// `bench` names the compact candidate that reproduces the decision, or
// `omitted` says why the model cannot choose it. test/bench-parity.test.mjs
// fails when `screen()` gains an action that is missing here, so a new human
// control cannot ship without a bench decision.
// ponytail: layout placement is delegated to the bill's auto-resolved layout;
// upgrade path: add slot candidates and delete the `omitted` reasons.
export const PREPARATION_ACTIONS = Object.freeze({
  'applicant-index': { bench: 'hire_*' },
  hire: { bench: 'hire_*' },
  skip: { bench: 'skip_hiring' },
  quantity: { bench: 'stock_*' },
  'quantity-input': { bench: 'stock_*' },
  duty: { bench: 'assign_*' },
  equipment: { bench: 'equipment_*' },
  vitamin: { bench: 'vitamin_*' },
  'vitamin-target': { bench: 'vitamin_*' },
  'vitamin-cancel': { bench: 'vitamin_undo' },
  next: { bench: 'open_shift' },
  page: { omitted: 'benchは対象ページへ直接遷移する' },
  'equipment-index': { omitted: 'benchは設備候補を全ページ分まとめて出す' },
  'layout-mode': { omitted: '配置は自動レイアウトで確定する' },
  'layout-index': { omitted: '配置は自動レイアウトで確定する' },
  'layout-select': { omitted: '配置は自動レイアウトで確定する' },
  'layout-slot': { omitted: '配置は自動レイアウトで確定する' },
});
export const useBenchmark = create(() => ({
  running: false,
  paused: false,
  splits: [],
  action: '',
  log: [],
  elapsedMs: 0,
  requests: 0,
  results: [],
}));
let controller;
const sleep = () => new Promise((resolve) => setTimeout(resolve, 50));

export function kitchenHasWork(g) {
  return (
    g.stock !== 0 ||
    [g.human, ...Object.values(g.crew)].some(
      (actor) => actor.carrying && actor.carrying !== 'plate',
    ) ||
    activeStationIds(g).some((id) =>
      ['chopping', 'chopped', 'cooking', 'ready'].includes(g.stations[id].state),
    )
  );
}

export function preparationCandidates(state, plan) {
  const g = state.game;
  const candidates = [{ id: 'wait', label: '準備内容を維持する' }];
  const duty = Array.isArray(plan.duty) ? plan.duty : [];
  const bill = purchase(g, plan);
  const available = { ...bill.staffState };
  if (plan.selected) available[plan.selected] = { worked: 0, rest: 0 };
  if (plan.selected || plan.stage === 'hiring')
    candidates.push({ id: 'skip_hiring', label: '採用を取り消す', selected: null });
  for (const id of state.applicants) {
    if (id !== plan.selected)
      candidates.push({
        id: `hire_${id}`,
        label: `${STAFF[id].name}を採用予定にする（${STAFF[id].cost}コイン）`,
        selected: id,
      });
  }
  for (const id of Object.keys(available)) {
    if (levelConfig(g.level + 1).partner) continue;
    if (duty.includes(id))
      candidates.push({
        id: `rest_${id}`,
        label: `${STAFF[id].name}を休ませる（給与を節約・連勤をリセット）`,
        duty: duty.filter((member) => member !== id),
      });
    else if (available[id].rest === 0 && duty.length < bill.slots)
      candidates.push({
        id: `assign_${id}`,
        label: `${STAFF[id].name}を出勤に追加する（給与${STAFF[id].wage}コイン）`,
        duty: [...duty, id],
      });
    else if (available[id].rest === 0)
      for (const outgoing of duty)
        candidates.push({
          id: `replace_${outgoing}_${id}`,
          label: `${STAFF[outgoing].name}を休ませ、${STAFF[id].name}に交代（${STAFF[id].description} 給与${STAFF[id].wage}）`,
          duty: duty.map((member) => (member === outgoing ? id : member)),
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
  const equipmentPurchases = [
    ...new Set(Array.isArray(plan.equipmentPurchases) ? plan.equipmentPurchases : []),
  ];
  const equipmentCost = quoteEquipment(g.equipment, equipmentPurchases, g.level + 1).cost;
  for (const kind of Object.keys(EQUIPMENT)) {
    for (const action of ['add', 'upgrade']) {
      const purchaseId = `${action}_${kind}`;
      const pending = equipmentPurchases.includes(purchaseId);
      const next = pending
        ? equipmentPurchases.filter((id) => id !== purchaseId)
        : [...equipmentPurchases, purchaseId];
      const quote = quoteEquipment(g.equipment, next, g.level + 1);
      if (quote.error) continue;
      const label = `${EQUIPMENT[kind].name}の${action === 'add' ? '増設' : '強化'}`;
      candidates.push({
        id: `equipment_${purchaseId}`,
        label: `${label}${pending ? 'を取り消す' : 'を予定する'}（${quote.cost - equipmentCost}コイン）`,
        equipmentPurchases: next,
      });
    }
  }
  const vitamins = Array.isArray(plan.vitamins) ? plan.vitamins : [];
  const vitaminTargets = [
    'human',
    ...new Set([...Object.keys(nextStaffState(g)), ...(plan.selected ? [plan.selected] : [])]),
  ];
  for (const item of Object.keys(VITAMINS)) {
    for (const target of vitaminTargets) {
      const next = [...vitamins, { item, target }];
      if (quoteVitamins(g.training, next, vitaminTargets).error) continue;
      candidates.push({
        id: `vitamin_${item}_${target}`,
        label: `${VITAMINS[item].name}を${target === 'human' ? 'プレイヤー（全営業に出勤）' : `${STAFF[target].name}（${duty.includes(target) ? '出勤予定' : '控え'}）`}に使う（${VITAMINS[item].cost}コイン）`,
        vitamins: next,
      });
    }
  }
  if (vitamins.length)
    candidates.push({
      id: 'vitamin_undo',
      label: '直前の育成を取り消す',
      vitamins: vitamins.slice(0, -1),
    });
  if (!purchase(g, plan).error)
    candidates.push({ id: 'open_shift', label: '採用・配置・仕入れを確定し、次の営業を始める' });
  // The same human decisions, one preparation page at a time. A single Choice
  // over hiring, 100 quantities and investments consistently skipped investing.
  if (plan.stage === 'hiring')
    return candidates.filter(
      (c) =>
        c.id === 'skip_hiring' ||
        (c.id.startsWith('hire_') &&
          STAFF[c.selected].cost +
            STAFF[c.selected].wage +
            Math.max(0, bill.quota - (g.stock ?? 0)) * STOCK_PRICE <=
            g.cash),
    );
  if (plan.stage === 'staffing') {
    const fixed = levelConfig(g.level + 1).partner;
    const ids = Object.keys(available).filter(
      (id) => available[id].rest === 0 && (!fixed || id === fixed),
    );
    const lineups = [];
    // ponytail: seven staff means at most 128 subsets; group roles if the roster grows.
    for (let mask = 0; mask < 2 ** ids.length; mask++) {
      const crew = ids.filter((_, index) => mask & (1 << index));
      if (crew.length > bill.slots || (fixed && !crew.includes(fixed))) continue;
      const minimum = purchase(g, {
        ...plan,
        duty: crew,
        quantity: Math.max(0, bill.quota - (g.stock ?? 0)),
      });
      if (minimum.error) continue;
      lineups.push({
        id: `crew_${crew.join('_') || 'solo'}`,
        label: `${crew.map((id) => `${STAFF[id].name}（${STAFF[id].capabilities.join('/')}）`).join(' ＋ ') || 'ひとり営業'} / 給与${payroll(crew)}コイン`,
        duty: crew,
      });
    }
    return lineups;
  }
  if (plan.stage === 'stock')
    return [
      ...candidates.filter(
        (c) => 'quantity' in c && !purchase(g, { ...plan, quantity: c.quantity }).error,
      ),
      ...(!bill.error ? [{ id: 'confirm_stock', label: `在庫${bill.stock}個で投資へ進む` }] : []),
    ];
  if (plan.stage === 'investment')
    return candidates.filter(
      (c) =>
        c.id === 'open_shift' ||
        c.id === 'vitamin_undo' ||
        (('vitamins' in c || 'equipmentPurchases' in c) && !purchase(g, { ...plan, ...c }).error),
    );
  return candidates;
}

function prepare(candidate, plan, g) {
  if (candidate.id === 'open_shift') {
    const bill = purchase(g, plan);
    if (bill.error) return false;
    return nextShift(
      plan.selected,
      bill.quantity,
      bill.duty,
      bill.equipmentPurchases,
      bill.layout,
      bill.vitamins,
    );
  }
  if ('selected' in candidate) {
    plan.duty = plan.duty.filter((id) => id !== plan.selected);
    plan.selected = candidate.selected;
    if (plan.stage) plan.stage = 'staffing';
  }
  if (candidate.id.startsWith('crew_')) plan.stage = 'stock';
  if (candidate.id === 'confirm_stock' || ('quantity' in candidate && plan.stage))
    plan.stage = 'investment';
  if ('duty' in candidate) plan.duty = [...candidate.duty];
  if ('quantity' in candidate) plan.quantity = candidate.quantity;
  if ('equipmentPurchases' in candidate) plan.equipmentPurchases = candidate.equipmentPurchases;
  if ('vitamins' in candidate) plan.vitamins = candidate.vitamins;
  if (plan.stage && ('selected' in candidate || 'duty' in candidate)) {
    const bill = purchase(g, plan);
    if (bill.cash < 0)
      plan.quantity = Math.max(
        0,
        bill.quota - (g.stock ?? 0),
        plan.quantity + Math.floor(bill.cash / STOCK_PRICE),
      );
  }
  if ('selected' in candidate) {
    plan.page = 1;
    plan.applicantIndex = Math.max(0, useKitchen.getState().applicants.indexOf(plan.selected));
  }
  if ('quantity' in candidate || 'duty' in candidate) plan.page = 2;
  if ('equipmentPurchases' in candidate || 'vitamins' in candidate) plan.page = 3;
  plan.recentActions = [...(plan.recentActions ?? []).slice(-5), candidate.id];
  useKitchen.setState({ benchPreparation: { ...plan } });
  return true;
}

function partner(g) {
  const id = g.duty?.[0] ?? null;
  return { id, actor: id ? (g.crew?.[id] ?? null) : null };
}

// Node tests have no window; the wide reference matches a desktop HUD.
function viewport() {
  return {
    width: Number(globalThis.innerWidth) || 1280,
    height: Number(globalThis.innerHeight) || 720,
  };
}

// One builder for the model context: structured state, the rendered screen,
// and bench-only timing. Kept out of the loop so it stays testable and the
// prompt cannot drift from what the player sees.
export function benchRequest(state, { preparing, plan, candidates }) {
  const g = state.game;
  const sous = partner(g);
  const actions = new Set(candidates.map((c) => c.id));
  return {
    state: {
      ...(preparing
        ? {
            level: g.level,
            cash: g.cash,
            stock: g.stock,
            equipment: g.equipment,
            training: g.training,
          }
        : observe(g, '', 'human')),
      controlled_actor: 'human',
      phase: preparing ? 'preparation' : 'playing',
      player_intent: preparing ? undefined : (g.human.intent?.id ?? null),
      dash_ready_in_ms: preparing ? undefined : Math.max(0, g.human.dashReadyAt - g.time),
      cooking: preparing
        ? undefined
        : Object.fromEntries(
            activeStationIds(g)
              .filter((id) => g.stations[id]?.duration !== undefined)
              .map((id) => {
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
              stage: plan.stage ?? null,
              recent_actions: plan.recentActions ?? [],
              duty: plan.duty,
              unfilled_slots: Math.max(0, levelConfig(g.level + 1).staffSlots - plan.duty.length),
              quantity: plan.quantity,
              recommended_purchase: recommendedStock(g),
              next_level: levelConfig(g.level + 1),
              previous_sales: g.served,
              previous_burned: g.burned,
              recipes: Object.fromEntries(
                Object.entries(RECIPES).map(([id, recipe]) => [
                  id,
                  {
                    revenue: Math.round(recipe.points / 4),
                    margin: Math.round(recipe.points / 4) - STOCK_PRICE,
                  },
                ]),
              ),
              equipment_catalog: EQUIPMENT,
              vitamin_catalog: VITAMINS,
              equipmentPurchases: plan.equipmentPurchases ?? [],
              layout: plan.layout ?? g.layout,
              bill: purchase(g, plan),
              stock_price: STOCK_PRICE,
              applicants: state.applicants.map((id) => ({ id, ...STAFF[id] })),
              roster: Object.entries(nextStaffState(g)).map(([id, schedule]) => ({
                id,
                ...STAFF[id],
                ...schedule,
              })),
            },
          }
        : {}),
      partner_intent: preparing ? undefined : (sous.actor?.intent?.id ?? null),
      position: preparing
        ? undefined
        : {
            human: { x: g.human.x, y: g.human.y },
            ai: sous.actor ? { x: sous.actor.x, y: sous.actor.y } : null,
          },
      screen: screenContext(
        state,
        plan ?? preparation(g),
        viewport().width,
        viewport().height,
        actions,
      ),
    },
    questions: preparing
      ? {
          next_action: {
            type: 'choice',
            instructions:
              {
                hiring:
                  'Choose one affordable recruit or skip. First hire a chef or sous for cooking. Later recruit only to fill an available slot or cover forced rest from Lv9. Skip redundant hires when the next crew is covered: preserve money for stock and permanent upgrades. Hiring alone does not assign duty.',
                staffing:
                  'Choose the best complete crew for the next shift. The human covers every role. For soup/grill, prioritize at least one cook: chef or sous. With one slot prefer a cook over a prep-only or delivery-only worker. With more slots combine cooking and serving. Fill useful slots when affordable. A new hire may stay in reserve; do not replace a strong cook just because someone was newly hired. Balance payroll and available fatigue/rest; each option is a complete duty roster.',
                stock:
                  'Choose the purchase quantity closest to recommended_purchase, or confirm_stock if it already matches. One tomato makes one dish. Sell beyond quota for profit; leftovers carry over. Stock should cover the whole shift, not only quota.',
                investment:
                  'Spend surplus on a permanent improvement each shift when affordable. bill.cash is AFTER supplies, wages and pending investments. First train human move and cook toward 5 each (45 coins each). For multiple prep workers add a second board. Then improve pot/grill speed, train regular crew, or buy a warmer after burning. Prefer improvement over open_shift when useful upgrades are affordable. Open when they are unaffordable or saving toward necessary equipment. Never undo useful purchases.',
              }[plan.stage] ??
              'Prepare the next shift within cash: hire, assign rested staff, buy surplus stock and invest, then open_shift. Each choice edits a pending plan.',
            criteria: Object.fromEntries(candidates.map((c) => [c.id, c.label])),
          },
        }
      : buildQuestions(candidates, 'human'),
  };
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

export function pauseBenchmark() {
  if (!useBenchmark.getState().running) return;
  if (useKitchen.getState().phase === 'playing') togglePause();
  else if (useKitchen.getState().phase === 'finished') useBenchmark.setState({ paused: true });
}

// The bench screen shares the game menu, so tab-hidden pausing must follow the
// same 「バックグラウンドモード」 option instead of always stopping.
export function pauseBenchmarkWhenAway() {
  if (!useKitchen.getState().backgroundMode) pauseBenchmark();
}

export function resumeBenchmark() {
  if (!useBenchmark.getState().running) return;
  if (useKitchen.getState().menuOpen) setMenuOpen(false);
  if (useKitchen.getState().phase === 'paused') togglePause();
  useBenchmark.setState({ paused: false });
}

export async function runBenchmark({ model, frequency = 5, maxRequests = 5000 }) {
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
  useBenchmark.setState({
    running: true,
    paused: false,
    splits: [],
    action: '',
    log: [],
    elapsedMs: 0,
    requests: 0,
  });
  let generation = 0;
  const unsubscribe = useKitchen.subscribe((next, previous) => {
    if (
      next.phase !== previous.phase ||
      next.game !== previous.game ||
      next.menuOpen !== previous.menuOpen
    )
      generation++;
  });
  try {
    startBenchmark();
    const started = performance.now();
    let lastClock = started;
    clock = setInterval(() => {
      const now = performance.now();
      if (!useBenchmark.getState().paused && useKitchen.getState().phase !== 'paused')
        useBenchmark.setState((state) => ({ elapsedMs: state.elapsedMs + now - lastClock }));
      lastClock = now;
    }, 100);
    const result = {
      protocol: BENCH_PROTOCOL,
      revision: import.meta.env?.VITE_COMMIT_SHA ?? 'development',
      model: { id: model.id, name: model.name },
      startedAt: new Date().toISOString(),
      conditions: {
        frequency,
        maxRequests,
        partner: 'rule',
        initialStaff: null,
        scriptedPartners: { 2: 'veteran', 3: 'veteran' },
        tutorialQuota: 1,
        tutorialSeconds: null,
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
        if (state.phase === 'paused' || state.menuOpen || useBenchmark.getState().paused) {
          await sleep();
          continue;
        }
        if (state.phase === 'finished') {
          if (result.levels.at(-1)?.level !== g.level) {
            const sous = partner(g);
            result.levels.push({
              level: g.level,
              cleared: state.cleared,
              served: g.served,
              playerServed: g.human.served,
              partnerServed: g.duty.reduce((sum, id) => sum + (g.crew[id]?.served ?? 0), 0),
              quota: g.quota,
              score: g.score,
              missed: g.missed,
              burned: g.burned,
              staffId: sous.id,
              duty: [...g.duty],
              hired: [...g.hired],
              stock: g.stock,
              lastServeSeconds: Number.isFinite(g.lastServeAt)
                ? Math.round(g.lastServeAt / 1000)
                : null,
              equipment: g.equipment,
              training: g.training,
              cash: g.cash,
              applicants: [...state.applicants],
            });
            useBenchmark.setState({ splits: result.levels.filter((level) => level.cleared) });
          }
          if (!state.cleared || g.level >= MAX_LEVEL) {
            result.status = state.cleared ? 'completed' : 'failed';
            break;
          }
          if (planningGame !== g) {
            plan = { ...preparation(g), stage: 'hiring' };
            planningGame = g;
            useKitchen.setState({ benchPreparation: plan });
          }
          plan = useKitchen.getState().benchPreparation;
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
        // Arrival revalidates the chosen action. Polling during the same trip
        // wastes calls and lets repeated replies interrupt productive work.
        if (!preparing && (g.human.intent || !kitchenHasWork(g))) {
          await sleep();
          continue;
        }
        const candidates = preparing
          ? preparationCandidates(state, plan)
          : buildCandidates(g, 'human');
        if (candidates.length === 1) {
          if (preparing) prepare(candidates[0], plan, g);
          else benchmarkAction(candidates[0]);
          await sleep();
          continue;
        }
        const requestGeneration = generation;
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
              ...benchRequest(state, { preparing, plan, candidates }),
            }),
          });
          if (!response.ok) throw new Error(`Decision endpoint: HTTP ${response.status}`);
          data = await response.json();
          if (!data.ok) throw new Error('モデルが判断を返しませんでした');
        } catch (error) {
          if (!session.signal.aborted && generation !== requestGeneration) {
            result.staleResponses++;
            continue;
          }
          throw error;
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
          generation === requestGeneration &&
          !useBenchmark.getState().paused &&
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
          log: [...state.log.slice(-200), { call: result.requests, action }],
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
      activeMs: Math.round(useBenchmark.getState().elapsedMs),
      finalShift: {
        level: g.level,
        elapsedMs: Math.round(g.time),
        served: g.served,
        playerServed: g.human.served,
        partnerServed: g.duty.reduce((sum, id) => sum + (g.crew[id]?.served ?? 0), 0),
        quota: g.quota,
        score: g.score,
      },
    });
    if (useKitchen.getState().phase === 'playing') togglePause();
    useBenchmark.setState((state) => ({ results: [...state.results, result] }));
  } finally {
    clearInterval(clock);
    unsubscribe();
    if (controller === session) controller = null;
    useBenchmark.setState({ running: false });
  }
}
