import { create } from 'zustand';
import {
  useKitchen,
  startBenchmark,
  startShift,
  setAutoMode,
  benchmarkAction,
  nextShift,
  setApplicantsRandom,
  togglePause,
  setMenuOpen,
} from './game.ts';
import {
  activeStationIds,
  buildCandidates,
  buildQuestions,
  cookingAdvice,
  kitchenHasWork,
  observe,
  MAX_LEVEL,
  STOCK_PRICE,
  RECIPES,
  levelConfig,
  recommendedStock,
  repeatsActions,
} from './model.ts';
export { kitchenHasWork };
import { STAFF, nextStaffState, payroll } from './staff.ts';
import { apiFetch, sessionSeed } from './api-client.ts';
import { seededRandom } from './applicants.ts';
import { EQUIPMENT, equipmentCapacity, quoteEquipment } from './equipment.ts';
import { VITAMINS, quoteVitamins } from './training.ts';
import {
  preparation,
  purchase,
  applyPreparationView,
  preparationAdvice,
  preparationKey,
  equipmentEffect,
  staffingOutlook,
} from './ui.ts';
import type {
  BenchDecision,
  BenchResult,
  BenchState,
  Candidate,
  DecisionContext,
  DecisionInput,
  EquipmentKind,
  GameState,
  PrepCandidate,
  StoreState,
  ViewState,
} from './types.ts';

export const BENCH_PROTOCOL = 'jev-bench-v4';

/** A user-supplied, Jev-compatible endpoint called directly from the browser. */
export interface DirectEndpoint {
  url: string;
  token?: string;
  model?: string;
}

/**
 * Validate an endpoint the user typed into the bench screen. Same shape the
 * Worker accepts for `BENCH_ENDPOINTS`, but here the browser calls it directly,
 * so the Worker never sees the URL or token. HTTPS only; no credentials in the
 * URL and no fragment.
 */
export function directEndpoint(value: unknown): DirectEndpoint | null {
  const entry = value as { url?: unknown; token?: unknown; model?: unknown } | null;
  if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') return null;
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
  if (entry.token !== undefined && typeof entry.token !== 'string') return null;
  if (entry.model !== undefined && typeof entry.model !== 'string') return null;
  return {
    url: url.href,
    ...(entry.token ? { token: entry.token } : {}),
    ...(entry.model ? { model: entry.model } : {}),
  };
}

// Single source of truth for preparation parity. Every action the human
// preparation sheet can render (see `screen()`) must be classified here: either
// `bench` names the compact candidate that reproduces the decision, or
// `omitted` says why the model cannot choose it. test/bench-parity.test.ts
// fails when `screen()` gains an action that is missing here, so a new human
// control cannot ship without a bench decision.
// ponytail: layout placement is delegated to the bill's auto-resolved layout;
// upgrade path: add slot candidates and delete the `omitted` reasons.
export const PREPARATION_ACTIONS: Record<string, { bench?: string; omitted?: string }> =
  Object.freeze({
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
    share: { omitted: 'Xへの投稿は試行の進行に影響しない' },
    advice: { omitted: '人間向けヒントを表示する' },
    page: { omitted: 'benchは対象ページへ直接遷移する' },
    'equipment-index': { omitted: 'benchは設備候補を全ページ分まとめて出す' },
    'layout-mode': { omitted: '配置は自動レイアウトで確定する' },
    'layout-index': { omitted: '配置は自動レイアウトで確定する' },
    'layout-select': { omitted: '配置は自動レイアウトで確定する' },
    'layout-slot': { omitted: '配置は自動レイアウトで確定する' },
  });
export const useBenchmark = create<BenchState>(() => ({
  running: false,
  paused: false,
  splits: [],
  action: '',
  log: [],
  elapsedMs: 0,
  requests: 0,
  results: [],
  verified: null,
}));
let controller: AbortController | null = null;
const sleep = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

// Movement aliases compete with the cooking action they duplicate. Keep every
// control reachable, but ask for free navigation separately from useful work.
export function playingCandidates(g: GameState, navigating = false): Candidate[] {
  return [
    ...buildCandidates(g, 'human').filter(
      (c) => /^(dash_)?(visit_|move_)/.test(c.id) === navigating,
    ),
    navigating
      ? { id: 'back_to_work', label: '調理の行動選択に戻る' }
      : { id: 'navigate', label: '作業せずに移動する場所を選ぶ（調理の行動は自動移動つき）' },
  ];
}

export function preparationCandidates(
  state: Pick<StoreState, 'game' | 'applicants'>,
  plan: ViewState,
): PrepCandidate[] {
  const g = state.game;
  const candidates: PrepCandidate[] = [{ id: 'wait', label: '準備内容を維持する' }];
  const duty = Array.isArray(plan.duty) ? plan.duty : [];
  const bill = purchase(g, plan);
  const available = { ...bill.staffState };
  if (plan.selected) available[plan.selected] = { worked: 0, rest: 0 };
  if (plan.selected || plan.stage === 'hiring')
    candidates.push({
      id: 'skip_hiring',
      label: plan.selected ? '採用を取り消す' : '今回は採用しない',
      selected: null,
    });
  for (const id of state.applicants) {
    if (id !== plan.selected) {
      const quote = purchase(g, {
        ...plan,
        selected: id,
        duty: duty.filter((id) => id !== plan.selected),
      });
      candidates.push({
        id: `hire_${id}`,
        label: `${STAFF[id].name}を採用予定にする（採用${STAFF[id].cost}・今の仕入れと配置で予定残金${quote.cash}コイン）`,
        selected: id,
      });
    }
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
      const capacityChange =
        kind === 'kitchen'
          ? `設備枠${equipmentCapacity(bill.equipment).limit}→${equipmentCapacity(quote.equipment).limit}、`
          : '';
      const effect =
        action === 'add' && ['board', 'pot', 'grill'].includes(kind)
          ? `同時に${quote.equipment[kind as EquipmentKind].count}台で調理できる`
          : equipmentEffect(kind, quote.equipment[kind as EquipmentKind]);
      candidates.push({
        id: `equipment_${pending ? 'cancel_' : ''}${purchaseId}`,
        label: `${label}${pending ? 'を取り消す' : 'を予定する'}（${capacityChange}${effect}・${quote.cost - equipmentCost}コイン）`,
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
        label: `${VITAMINS[item].name}を${target === 'human' ? 'プレイヤー（全営業に出勤）' : `${STAFF[target].name}（${duty.includes(target) ? '出勤予定' : '控え'}）`}に使う（${VITAMINS[item].cost}コイン・${VITAMINS[item].effect}）`,
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
          !!c.selected &&
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
      const outlook = staffingOutlook(g, { ...plan, duty: crew });
      lineups.push({
        id: `crew_${crew.join('_') || 'solo'}`,
        label: `${crew.map((id) => `${STAFF[id].name}（${STAFF[id].capabilities.join('/')}・連勤${available[id].worked}/${STAFF[id].maxConsecutive}）`).join(' ＋ ') || 'ひとり営業'} / 給与${payroll(crew)}コイン${outlook ? ` / ${outlook}` : ''}`,
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

function prepare(candidate: PrepCandidate, plan: ViewState, g: GameState): boolean {
  if (candidate.id === 'open_shift') {
    const bill = purchase(g, plan);
    if (bill.error) return false;
    return nextShift(
      plan.selected ?? null,
      bill.quantity,
      bill.duty,
      bill.equipmentPurchases,
      bill.layout,
      bill.vitamins,
    );
  }
  if ('selected' in candidate) {
    plan.duty = (plan.duty ?? []).filter((id) => id !== plan.selected);
    plan.selected = candidate.selected ?? null;
    if (plan.stage) plan.stage = 'staffing';
  }
  if (candidate.id.startsWith('crew_')) plan.stage = 'stock';
  if (candidate.id === 'confirm_stock' || ('quantity' in candidate && plan.stage))
    plan.stage = 'investment';
  if ('duty' in candidate) plan.duty = [...(candidate.duty ?? [])];
  if ('quantity' in candidate) plan.quantity = candidate.quantity;
  if ('equipmentPurchases' in candidate) plan.equipmentPurchases = candidate.equipmentPurchases;
  if ('vitamins' in candidate) plan.vitamins = candidate.vitamins;
  if (plan.stage && ('selected' in candidate || 'duty' in candidate)) {
    const bill = purchase(g, plan);
    if (bill.cash < 0)
      plan.quantity = Math.max(
        0,
        bill.quota - (g.stock ?? 0),
        (Number(plan.quantity) || 0) + Math.floor(bill.cash / STOCK_PRICE),
      );
  }
  if ('selected' in candidate) plan.page = 1;
  if ('quantity' in candidate || 'duty' in candidate) plan.page = 2;
  if ('equipmentPurchases' in candidate || 'vitamins' in candidate) plan.page = 3;
  applyPreparationView(candidate, plan, g, useKitchen.getState().applicants);
  useKitchen.setState({ benchPreparation: { ...plan } });
  return true;
}

function partner(g: GameState) {
  const id = g.duty?.[0] ?? null;
  return { id, actor: id ? (g.crew?.[id] ?? null) : null };
}

export function compactDecisionState(s: DecisionInput): DecisionContext {
  if (s.phase === 'preparation') {
    const p = s.preparation;
    if (!p) return { phase: s.phase };
    const b = p.bill;
    const stage = p.stage;
    return {
      phase: s.phase,
      preparation: {
        stage,
        ...(stage === 'hiring' || stage === 'staffing' ? { cash_before_purchase: s.cash } : {}),
        cash_remaining: b.cash,
        next_level: {
          level: p.next_level.level,
          quota: p.next_level.quota,
          staffSlots: p.next_level.staffSlots,
          recipeMix: p.next_level.recipeMix,
        },
        duty: p.duty ?? [],
        stock: b.stock,
        ...(stage === 'stock'
          ? {
              quantity: p.quantity,
              recommended_purchase: p.recommended_purchase,
              previous_sales: p.previous_sales,
              stock_price: STOCK_PRICE,
              menu_prices: Object.fromEntries(
                Object.entries(RECIPES).map(([id, r]) => [id, r.price]),
              ),
            }
          : {}),
        ...(stage === 'hiring' || stage === 'staffing'
          ? {
              roster: (p.roster ?? []).map((x) => ({
                id: x.id,
                capabilities: x.capabilities,
                wage: x.wage,
                worked: x.worked,
                rest: x.rest,
              })),
              applicants: (p.applicants ?? []).map((x) => ({
                id: x.id,
                capabilities: x.capabilities,
                cost: x.cost,
                wage: x.wage,
              })),
            }
          : {}),
        ...(stage === 'investment'
          ? {
              equipment: b.equipment,
              equipment_capacity: equipmentCapacity(b.equipment),
              training: b.training,
              pending_equipment: p.equipmentPurchases ?? [],
              recent_actions: p.recent_actions ?? [],
            }
          : {}),
      },
    };
  }
  return {
    phase: s.phase,
    controlled_actor: s.controlled_actor,
    level: s.level,
    quota: s.quota,
    orders_served: s.orders_served,
    stock: s.stock,
    seconds_left: s.seconds_left,
    human: s.human as DecisionContext['human'],
    crew: s.crew,
    orders: s.orders,
    recipes: Object.fromEntries(
      [...new Set((s.orders ?? []).map((o) => o.recipe))].map((id) => [id, RECIPES[id].steps]),
    ),
    dash_ready_in_ms: s.dash_ready_in_ms,
    stations: Object.fromEntries(
      Object.entries(s.stations ?? {})
        .filter(([, v]) => v.active)
        .map(([id, v]) => [
          id,
          {
            x: v.x,
            y: v.y,
            state: v.state,
            by: v.by,
            burn_seconds: v.burn_seconds,
            ...s.cooking?.[id],
          },
        ]),
    ),
  };
}

// Share the game observation, then keep only facts needed for this decision.
// In preparation the pending bill is authoritative; old equipment and UI text
// made the model undo purchases it had just selected.
export function benchRequest(
  state: StoreState,
  {
    preparing,
    plan,
    candidates,
    decisions = [],
    repeatedPlanVisits = 0,
  }: {
    preparing: boolean;
    plan: ViewState;
    candidates: Candidate[];
    decisions?: BenchDecision[];
    repeatedPlanVisits?: number;
  },
) {
  const g = state.game;
  const recent = decisions
    .filter(
      (d) =>
        d.level === g.level &&
        d.phase === (preparing ? 'preparation' : 'playing') &&
        (!preparing || d.stage === plan.stage),
    )
    .slice(-6);
  const looping = preparing ? repeatedPlanVisits >= 2 : repeatsActions(recent, g);
  const bill = purchase(g, plan);
  const request: { state: DecisionInput; questions: ReturnType<typeof buildQuestions> } = {
    state: {
      ...(preparing
        ? {
            level: g.level,
            cash: g.cash,
            stock: g.stock,
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
                    remaining_ms: Math.max(0, (station.busyUntil ?? 0) - g.time),
                    progress: station.duration
                      ? (g.time - (station.startedAt ?? 0)) / station.duration
                      : null,
                    boosted: Boolean(station.boosted),
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
              unfilled_slots: Math.max(
                0,
                levelConfig(g.level + 1).staffSlots - (plan.duty ?? []).length,
              ),
              quantity: plan.quantity,
              recommended_purchase: recommendedStock(g),
              previous_sales: g.served,
              next_level: levelConfig(g.level + 1),
              equipmentPurchases: plan.equipmentPurchases ?? [],
              bill,
              applicants: state.applicants.map((id) => ({ id, ...STAFF[id] })),
              roster: Object.entries(nextStaffState(g)).map(([id, schedule]) => ({
                id,
                ...STAFF[id],
                ...schedule,
              })),
            },
          }
        : {}),
    },
    questions: buildQuestions(candidates, 'human'),
  };
  const context = compactDecisionState(request.state);
  if (preparing && plan.stage === 'investment')
    request.questions.next_action.instructions =
      'You control the HUMAN player in a cooking campaign. Choose one action that improves the chance of clearing this and later shifts. Each shift requires serving the quota before time runs out. Cash and upgrades carry over.';
  // One bounded history replaces duplicate actor and preparation logs.
  if (context.human) Reflect.deleteProperty(context.human, 'recent_actions');
  if (context.preparation) Reflect.deleteProperty(context.preparation, 'recent_actions');
  return {
    ...request,
    state: {
      ...context,
      situation: preparing
        ? preparationAdvice(g, plan).instructions
        : cookingAdvice(g, candidates).instructions,
      recent_actions: recent.map(({ action, applied }) => ({ action, applied })),
      ...(looping
        ? {
            loop_warning: preparing
              ? 'The same purchase plan has been revisited; purchases and cancellations are repeating.'
              : 'Possible loop: recent actions repeat without using stock or serving food.',
          }
        : {}),
    },
  };
}

export function latencyStats(values: number[]): { meanMs: number | null; p95Ms: number | null } {
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

// Normal play shares the controller without resetting or ranking the campaign.
export function installAutoMode() {
  const sync = () => {
    const state = useKitchen.getState();
    if (state.autoMode && state.ready && !useBenchmark.getState().running)
      void runBenchmark({ model: { id: 'jev', name: 'Jev' }, autoplay: true });
  };
  const unsubscribeGame = useKitchen.subscribe(sync);
  const unsubscribeBench = useBenchmark.subscribe(sync);
  sync();
  return () => {
    unsubscribeGame();
    unsubscribeBench();
    setAutoMode(false);
  };
}

/**
 * Ask a user-added endpoint directly. The Worker is bypassed on purpose so the
 * key stays in the browser. Such runs are neither recorded nor ranked, because
 * the Worker never sees the decision. The endpoint must allow CORS.
 */
async function directDecision(
  endpoint: DirectEndpoint,
  body: string,
  signal: AbortSignal,
): Promise<{
  ok: true;
  result: { answers?: { next_action?: { choice?: string; confidence?: number } } };
  via: string;
}> {
  let response: Response;
  try {
    response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {}),
      },
      body,
      signal,
      redirect: 'manual',
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('モデルに接続できませんでした（Base URL・APIキー・CORSを確認してください）');
  }
  if (!response.ok) throw new Error(`Decision endpoint: HTTP ${response.status}`);
  return { ok: true, result: await response.json(), via: 'browser-direct' };
}

export async function runBenchmark({
  model,
  frequency = 5,
  maxRequests = 5000,
  autoplay = false,
}: {
  model: { id: unknown; name: unknown; endpoint?: unknown } | null;
  frequency?: number;
  maxRequests?: number;
  autoplay?: boolean;
}) {
  if (useBenchmark.getState().running || !useKitchen.getState().ready) return;
  if (autoplay && !useKitchen.getState().autoMode) return;
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
  // A user-added model carries its own endpoint and is called from the browser.
  const endpoint = directEndpoint(model.endpoint);
  if (model.endpoint !== undefined && !endpoint) throw new Error('実行条件が不正です');
  const session = new AbortController();
  let clock: ReturnType<typeof setInterval> | undefined;
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
    if (autoplay && !next.autoMode) session.abort(new Error('オートモードを終了しました'));
    if (
      next.phase !== previous.phase ||
      next.game !== previous.game ||
      next.menuOpen !== previous.menuOpen ||
      next.benchPreparation !== previous.benchPreparation
    )
      generation++;
  });
  try {
    if (!autoplay) startBenchmark();
    const started = performance.now();
    let lastClock = started;
    clock = setInterval(() => {
      const now = performance.now();
      if (!useBenchmark.getState().paused && useKitchen.getState().phase !== 'paused')
        useBenchmark.setState((state) => ({ elapsedMs: state.elapsedMs + now - lastClock }));
      lastClock = now;
    }, 100);
    const result: BenchResult = {
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
      reachedLevel: 1,
      clearedLevels: 0,
      wallMs: 0,
      activeMs: 0,
      finalShift: {
        level: 1,
        elapsedMs: 0,
        served: 0,
        playerServed: 0,
        partnerServed: 0,
        quota: 0,
        score: 0,
      },
    };
    const latencies: number[] = [];
    let nextCallAt = 0;
    let plan: ViewState = {};
    let applicantSeedSet = false;
    let planningGame: GameState | undefined;
    let navigating = false;
    const preparationVisits = new Map<string, number>();
    let repeatedPlanVisits = 0;
    try {
      while (true) {
        session.signal.throwIfAborted();
        const state = useKitchen.getState();
        const g = state.game;
        if (autoplay && state.phase === 'ready' && !state.menuOpen) {
          if (state.ready) startShift();
          else await sleep();
          continue;
        }
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
            preparationVisits.clear();
            repeatedPlanVisits = 0;
            navigating = false;
            const initialPlan =
              autoplay && state.benchPreparation ? state.benchPreparation : preparation(g);
            plan = {
              ...initialPlan,
              stage: initialPlan.stage ?? (initialPlan.selected ? 'staffing' : 'hiring'),
            };
            planningGame = g;
            useKitchen.setState({ benchPreparation: plan });
          }
          plan = useKitchen.getState().benchPreparation ?? plan;
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
        const candidates: Candidate[] = preparing
          ? preparationCandidates(state, plan)
          : playingCandidates(g, navigating);
        if (candidates.length === 1) {
          if (preparing) prepare(candidates[0], plan, g);
          else benchmarkAction(candidates[0]);
          await sleep();
          continue;
        }
        const requestGeneration = generation;
        const stage = preparing ? plan.stage : null;
        const { stock, served } = g;
        const request = benchRequest(state, {
          preparing,
          plan,
          candidates,
          decisions: result.decisions,
          repeatedPlanVisits,
        });
        useKitchen.setState({
          benchFeedback: {
            loop: Boolean(request.state.loop_warning),
            recent: result.decisions
              .filter(
                (d) => d.level === g.level && d.phase === (preparing ? 'preparation' : 'playing'),
              )
              .slice(-6)
              .map((d) => `${d.label ?? d.action}${d.applied ? '' : '（状況が変わり未適用）'}`),
          },
        });
        const body = JSON.stringify(
          endpoint
            ? { ...(endpoint.model ? { model: endpoint.model } : {}), ...request }
            : { modelId: model.id, ...request },
        );
        const requestStart = performance.now();
        nextCallAt = requestStart + 1000 / frequency;
        result.requests++;
        useBenchmark.setState({ requests: result.requests, action: '判断中…' });
        let data: {
          ok?: boolean;
          result?: { answers?: { next_action?: { choice?: string; confidence?: number } } };
          via?: string;
        };
        try {
          if (endpoint) {
            data = await directDecision(
              endpoint,
              body,
              AbortSignal.any([session.signal, AbortSignal.timeout(10000)]),
            );
          } else {
            const response = await apiFetch(
              autoplay ? '/api/decide' : '/api/bench/decide',
              body,
              autoplay ? 'play' : 'bench',
              {
                signal: AbortSignal.any([session.signal, AbortSignal.timeout(10000)]),
              },
            );
            if (!response.ok) throw new Error(`Decision endpoint: HTTP ${response.status}`);
            data = await response.json();
            if (!data.ok) throw new Error('モデルが判断を返しませんでした');
          }
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
        if (!autoplay && !endpoint && !applicantSeedSet) {
          // Rank verification replays from the server seed, so seed the client
          // applicant draw once the session exists (never before the first
          // decision, which would change the synchronous request timing).
          applicantSeedSet = true;
          const seed = await sessionSeed('bench').catch(() => undefined);
          setApplicantsRandom(Number.isFinite(seed) ? seededRandom(seed as number) : null);
        }
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
          (preparing
            ? prepare(selected, plan, g)
            : selected.id === 'navigate' ||
              selected.id === 'back_to_work' ||
              benchmarkAction(selected));
        if (applied && !preparing) navigating = selected.id === 'navigate';
        if (!applied) result.staleResponses++;
        result.decisions.push({
          level: g.level,
          phase: preparing ? 'preparation' : 'playing',
          stage,
          stock,
          served,
          atMs: Math.round(g.time),
          action: selected.id,
          label: selected.label,
          applied,
          latencyMs: Math.round(latencies.at(-1) ?? 0),
          via: data.via,
          confidence: data.result?.answers?.next_action?.confidence ?? null,
          candidateCount: candidates.length,
          requestBytes: new TextEncoder().encode(body).length,
        });
        if (preparing && applied && selected.id !== 'open_shift') {
          const signature = preparationKey(plan);
          const visits = (preparationVisits.get(signature) ?? 0) + 1;
          preparationVisits.set(signature, visits);
          repeatedPlanVisits = visits;
          if (visits >= 3) throw new Error('Preparation cycle: same plan chosen three times');
        }
        const action = applied ? selected.label : '状況が変わったため再判断';
        if (autoplay) useKitchen.setState({ autoStatus: action });
        useBenchmark.setState((state) => ({
          action,
          log: [...state.log.slice(-200), { call: result.requests, action }],
        }));
        await sleep();
      }
    } catch (error) {
      result.status = session.signal.aborted ? 'stopped' : 'error';
      result.error = session.signal.aborted
        ? String(session.signal.reason?.message ?? session.signal.reason)
        : (error as Error).message;
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
    if ((!autoplay || !session.signal.aborted) && useKitchen.getState().phase === 'playing')
      togglePause();
    if (autoplay) {
      if (!session.signal.aborted) {
        setAutoMode(false);
        useKitchen.setState({
          autoStatus:
            result.error ??
            (result.status === 'budget' ? '判断回数の上限で停止しました' : '営業を終了しました'),
        });
      }
    } else useBenchmark.setState((state) => ({ results: [...state.results, result] }));
  } finally {
    clearInterval(clock);
    unsubscribe();
    if (controller === session) controller = null;
    if (!autoplay) setApplicantsRandom(null);
    useBenchmark.setState({ running: false });
  }
}

/**
 * Ask the server to replay its own decision chain and publish the verified
 * score. Called by the bench screen after a run, never inside `runBenchmark`,
 * so a stalled request cannot delay or break the run itself.
 */
export function submitRun() {
  return apiFetch('/api/runs/finish', {}, 'bench')
    .then(async (response) => {
      const data = await response.json().catch(() => null);
      if (response.ok && data?.ok) useBenchmark.setState({ verified: data.result });
    })
    .catch(() => {
      /* Ranking is best-effort; the local result still stands. */
    });
}
