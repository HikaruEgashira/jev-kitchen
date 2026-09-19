import { create } from 'zustand';
import {
  createGame,
  stationAt,
  moveToward,
  interact,
  advance,
  buildCandidates,
  isFeasible,
  buildQuestions,
  rulePick,
  observe,
  discard,
  dash,
  STATIONS,
  activeStationIds,
  kitchenBounds,
  completeOnboarding,
  quotaForLevel,
  MAX_LEVEL,
  STOCK_PRICE,
  SPEED,
} from './model.js';
import { createAudio } from './audio.js';
import { STAFF } from './staff.js';

const BEST_KEY = 'sidekick-best-v2';
const ONBOARDED_KEY = 'sidekick-onboarded-v1';
export const CHECKPOINT_KEY = 'sidekick-campaign-v1';
const CHECKPOINT_VERSION = 1;
const STARTING_CASH = 120;

function savedBest() {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function safeMoney(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeStock(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function validateCheckpoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== CHECKPOINT_VERSION || typeof value.completed !== 'boolean') return null;
  if (!Number.isSafeInteger(value.level) || value.level < 1 || value.level > MAX_LEVEL) return null;
  if (!safeMoney(value.cash) || !safeStock(value.stock)) return null;
  if ((value.level === 1) !== (value.stock === null)) return null;
  if (value.level > 1 && value.stock < quotaForLevel(value.level)) return null;
  if (!Object.hasOwn(STAFF, value.staffId)) return null;
  if (!Array.isArray(value.hired) || value.hired.length === 0) return null;
  if (new Set(value.hired).size !== value.hired.length) return null;
  if (
    !value.hired.every((id) => typeof id === 'string' && Object.hasOwn(STAFF, id)) ||
    !value.hired.includes('helper') ||
    !value.hired.includes(value.staffId)
  )
    return null;
  return {
    version: CHECKPOINT_VERSION,
    level: value.level,
    cash: value.cash,
    stock: value.stock,
    staffId: value.staffId,
    hired: [...value.hired],
    completed: value.completed,
  };
}

function readCheckpoint() {
  try {
    const raw = globalThis.localStorage?.getItem(CHECKPOINT_KEY);
    return typeof raw === 'string' ? validateCheckpoint(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCheckpoint(value, completed = false) {
  const record = validateCheckpoint({ ...value, version: CHECKPOINT_VERSION, completed });
  if (!record) return null;
  try {
    globalThis.localStorage?.setItem(CHECKPOINT_KEY, JSON.stringify(record));
  } catch {
    /* Storage is optional; the in-memory checkpoint still protects this session. */
  }
  return record;
}

const initialCheckpoint = readCheckpoint();

export const useKitchen = create(() => ({
  game:
    initialCheckpoint && !initialCheckpoint.completed
      ? createGame(initialCheckpoint)
      : createGame(),
  phase: 'ready',
  revision: 0,
  mode: 'jev',
  policy: '',
  backend: '準備中',
  ready: false,
  sound: true,
  best: savedBest(),
  checkpoint: initialCheckpoint,
  cleared: false,
  applicants: [],
  campaignComplete: false,
  tutorial: null,
  toast: '',
  toastUntil: 0,
  celebration: 0,
  lastPoints: 0,
  hud: {
    action: '一緒に、開店の準備をしよう。',
    latency: null,
    via: '—',
    confidence: null,
    dropped: 0,
    decisions: 0,
  },
  log: [],
  fallback: false,
}));

const keys = new Set();
let target = null,
  controller = null,
  epoch = 0,
  lastDecision = -Infinity,
  policyChangedAt = -Infinity,
  retryAt = 0,
  lastPublish = 0;
let audio;
const MODES = new Set(['jev', 'rule', 'llm']);
// Keep 1 FPS timing honest; visibility and blur pause longer stalls.
const MAX_FRAME_DELTA = 1;
const POLICY_DEBOUNCE_MS = 420;
export const TUTORIAL_STEPS = Object.freeze([
  Object.freeze({ station: 'crate', label: 'トマトへ WASD', icon: '🍅' }),
  Object.freeze({ station: 'board', label: 'まな板で E', icon: '🔪' }),
  Object.freeze({ station: 'plates', label: 'お皿へ WASD → E', icon: '🍽️' }),
  Object.freeze({ station: 'board', label: 'まな板へ WASD → E', icon: '🥗' }),
  Object.freeze({ station: 'serve', label: '配膳へ WASD → E', icon: '✨' }),
]);
const state = useKitchen.getState;
const update = useKitchen.setState;
let shiftSnapshot = null;

function playSound(kind) {
  if (!state().sound) return;
  audio ??= createAudio();
  audio.play(kind);
}

function invalidate() {
  epoch++;
  controller?.abort();
  controller = null;
  state().game.ai.intent = null;
  lastDecision = -Infinity;
}

function publish() {
  update({ revision: state().revision + 1 });
}

function notify(text) {
  update({ toast: text, toastUntil: state().game.time + 2400 });
}

function onboarded() {
  try {
    return globalThis.localStorage?.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveOnboarded() {
  try {
    globalThis.localStorage?.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* Storage is optional; a failed write simply repeats onboarding next visit. */
  }
}

function snapshot(g) {
  const hired = [
    ...new Set(
      (Array.isArray(g.hired) ? g.hired : []).filter(
        (id) => typeof id === 'string' && Object.hasOwn(STAFF, id),
      ),
    ),
  ];
  if (!hired.includes('helper')) hired.unshift('helper');
  const level = Number.isSafeInteger(g.level) && g.level >= 1 && g.level <= MAX_LEVEL ? g.level : 1;
  const staffId =
    Object.hasOwn(STAFF, g.staffId) && hired.includes(g.staffId) ? g.staffId : 'helper';
  return {
    level,
    cash: safeMoney(g.cash) ? g.cash : STARTING_CASH,
    stock: level === 1 ? null : Number.isSafeInteger(g.stock) && g.stock >= 0 ? g.stock : 0,
    staffId,
    hired,
  };
}

function drawApplicants(hired) {
  const pool = Object.keys(STAFF).filter((id) => id !== 'helper' && !hired.includes(id));
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, 3);
}

function finishOnboarding() {
  const g = state().game;
  keys.clear();
  target = null;
  retryAt = 0;
  lastPublish = 0;
  policyChangedAt = -Infinity;
  completeOnboarding(g);
  shiftSnapshot = snapshot(g);
  saveOnboarded();
  const checkpoint = writeCheckpoint(shiftSnapshot);
  invalidate();
  update({ tutorial: null, cleared: false, applicants: [], campaignComplete: false, checkpoint });
  notify('営業開始！');
  playSound('start');
  publish();
}

function record(who, result) {
  const g = state().game,
    actor = g[who];
  actor.action = result.action;
  if (actor.lastActions)
    actor.lastActions = [...actor.lastActions.slice(-5), { t: g.time, label: result.action }];
  update({ log: [{ who, text: result.action }, ...state().log].slice(0, 6) });
  if (result.points) {
    update({ celebration: state().celebration + 1, lastPoints: result.points });
    notify(`お待たせしました！ +${result.points}`);
    playSound('success');
  } else if (result.quality) {
    notify('NICE! ✨');
    playSound('success');
  } else if (who === 'human') playSound('action');
  publish();
}

function beginShift({
  practice = false,
  level = 1,
  cash = STARTING_CASH,
  staffId = 'helper',
  hired = ['helper'],
  stock = null,
} = {}) {
  invalidate();
  keys.clear();
  target = null;
  retryAt = 0;
  lastPublish = 0;
  policyChangedAt = -Infinity;
  const game = createGame({ practice, level, cash, staffId, hired, stock });
  const checkpoint = !practice ? writeCheckpoint(snapshot(game)) : null;
  if (!practice) shiftSnapshot = checkpoint;
  update({
    game,
    phase: 'playing',
    tutorial: practice ? 0 : null,
    cleared: false,
    applicants: [],
    campaignComplete: false,
    checkpoint: practice ? state().checkpoint : checkpoint,
    log: [],
    toast: '',
    toastUntil: 0,
    celebration: 0,
    fallback: false,
    lastPoints: 0,
    hud: {
      action: practice ? TUTORIAL_STEPS[0].label : 'さあ、最初の注文を作ろう！',
      latency: null,
      via: '—',
      confidence: null,
      dropped: 0,
      decisions: 0,
    },
  });
  playSound('start');
  publish();
}

export function startShift() {
  if (!state().ready) return;
  const saved = state().phase === 'ready' ? readCheckpoint() : null;
  update({ checkpoint: saved });
  if (saved?.completed) {
    beginShift({
      level: 1,
      cash: STARTING_CASH,
      staffId: 'helper',
      hired: ['helper'],
      stock: null,
    });
  } else if (saved) {
    beginShift(saved);
  } else if (onboarded()) {
    beginShift({
      level: 1,
      cash: STARTING_CASH,
      staffId: 'helper',
      hired: ['helper'],
      stock: null,
    });
  } else {
    beginShift({
      practice: true,
      level: 1,
      cash: STARTING_CASH,
      staffId: 'helper',
      hired: ['helper'],
    });
  }
}

export function togglePause() {
  const phase = state().phase;
  if ((phase !== 'playing' && phase !== 'paused') || !state().ready) return;
  invalidate();
  keys.clear();
  target = null;
  const nextPhase = phase === 'playing' ? 'paused' : 'playing';
  update({ phase: nextPhase });
  if (nextPhase === 'paused') audio?.stop();
}

export function graphicsLost() {
  const phase = state().phase;
  invalidate();
  keys.clear();
  target = null;
  audio?.stop();
  update({ ready: false, phase: phase === 'playing' ? 'paused' : phase });
}

export function setMode(mode) {
  if (!MODES.has(mode)) return;
  invalidate();
  retryAt = 0;
  update({ mode, fallback: false, hud: { ...state().hud, action: '次の仕事を探しているよ。' } });
}

export function setPolicy(policy) {
  invalidate();
  policyChangedAt = state().game.time;
  update({ policy: typeof policy === 'string' ? policy.slice(0, 300) : '' });
}

export function nextShift(applicantId = null, buyStock, assignedId) {
  const current = state();
  if (current.phase !== 'finished' || !current.cleared || current.campaignComplete) return false;
  const g = current.game;
  const currentLevel = Math.floor(Number(g.level) || 1);
  if (currentLevel >= MAX_LEVEL) return false;
  const nextLevel = currentLevel + 1;
  const applicants = Array.isArray(current.applicants) ? current.applicants : [];
  const selected =
    applicantId === null
      ? null
      : typeof applicantId === 'string' &&
          Object.hasOwn(STAFF, applicantId) &&
          applicants.includes(applicantId)
        ? STAFF[applicantId]
        : null;
  if (applicantId !== null && !selected) return false;
  const stock = Number.isFinite(g.stock) ? Math.max(0, Math.floor(g.stock)) : 0;
  const requiredStock = quotaForLevel(nextLevel);
  const purchased = buyStock === undefined ? Math.max(0, requiredStock + 2 - stock) : buyStock;
  if (!Number.isInteger(purchased) || purchased < 0 || purchased > 99) return false;
  if (stock + purchased < requiredStock) return false;
  const hiringCost = selected ? Math.max(0, Number(selected.cost) || 0) : 0;
  const cash = Number.isFinite(g.cash) ? g.cash : 0;
  if (hiringCost + purchased * STOCK_PRICE > cash) return false;
  const hired = Array.isArray(g.hired) && g.hired.length ? [...g.hired] : ['helper'];
  if (selected && !hired.includes(applicantId)) hired.push(applicantId);
  const activeId = assignedId === undefined ? (selected ? applicantId : g.staffId) : assignedId;
  if (typeof activeId !== 'string' || !Object.hasOwn(STAFF, activeId) || !hired.includes(activeId))
    return false;
  beginShift({
    level: nextLevel,
    cash: cash - hiringCost - purchased * STOCK_PRICE,
    stock: stock + purchased,
    staffId: activeId,
    hired,
  });
  return true;
}

export function retryShift() {
  const current = state();
  if (current.phase !== 'finished' || current.cleared || !shiftSnapshot) return false;
  beginShift({ ...shiftSnapshot });
  return true;
}

export function toggleSound() {
  const sound = !state().sound;
  update({ sound });
  audio?.setEnabled(sound);
}

function tutorialStep() {
  const step = state().tutorial;
  return Number.isInteger(step) && step >= 0 && step < TUTORIAL_STEPS.length ? step : null;
}

export function goTo(id) {
  const current = state();
  if (current.phase !== 'playing' || !STATIONS[id]) return;
  if (!activeStationIds(current.game).includes(id)) return;
  const step = tutorialStep();
  if (state().tutorial === TUTORIAL_STEPS.length) return;
  if (step !== null && TUTORIAL_STEPS[step].station !== id) {
    notify(`次は「${TUTORIAL_STEPS[step].label}」`);
    return;
  }
  const near = stationAt(current.game, 'human');
  if (near.inReach && near.id === id) {
    humanInteract(false);
    if (state().tutorial === 3 && current.game.stations.board.state === 'chopping') target = id;
    return;
  }
  target = id;
}

export function humanInteract(automatic = false) {
  if (state().phase !== 'playing') return;
  const g = state().game,
    near = stationAt(g, 'human');
  const step = tutorialStep();
  if (state().tutorial === TUTORIAL_STEPS.length) return;
  if (step !== null && near.id !== TUTORIAL_STEPS[step].station) {
    if (!automatic) notify(`次は「${TUTORIAL_STEPS[step].label}」`);
    return;
  }
  if (step === 3 && g.stations.board.state === 'chopping') return;
  if (!near.inReach) {
    notify('作業台をクリックすると、そこまで移動できるよ');
    return;
  }
  if (
    automatic &&
    !g.human.carrying &&
    ['chopping', 'cooking'].includes(g.stations[near.id].state)
  ) {
    target = null;
    return;
  }
  target = null;
  const result = interact(g, 'human', near.id);
  if (result.ok) {
    record('human', result);
    if (step !== null && state().tutorial === step) {
      const next = step + 1;
      if (next === TUTORIAL_STEPS.length) {
        finishOnboarding();
        return;
      }
      update({
        tutorial: next,
        hud: {
          ...state().hud,
          action: next < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[next].label : '練習完了！',
        },
      });
      publish();
    }
  } else {
    notify(result.reason);
    playSound('failure');
  }
}

export function clearHands() {
  if (state().phase !== 'playing' || state().tutorial !== null) return;
  if (discard(state().game, 'human')) {
    notify('手を空けたよ。コンボはリセット');
    publish();
  }
}

export function humanDash() {
  if (state().phase === 'playing' && dash(state().game)) playSound('dash');
}

export function installControls() {
  const typing = (e) => e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  const down = (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (e.repeat || document.querySelector?.('dialog[open]')) return;
      togglePause();
      return;
    }
    if (state().phase !== 'playing') return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      e.preventDefault();
      keys.add(key);
      target = null;
    } else if (!e.repeat) {
      if (key === 'e') {
        e.preventDefault();
        humanInteract();
      }
      if (key === 'shift') {
        e.preventDefault();
        humanDash();
      }
      if (key === 'q') {
        e.preventDefault();
        clearHands();
      }
    }
  };
  const up = (e) => keys.delete(e.key.toLowerCase());
  const blur = () => {
    keys.clear();
    if (state().phase === 'playing') togglePause();
  };
  const visibility = () => {
    if (document.hidden && state().phase === 'playing') togglePause();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', visibility);
    invalidate();
    keys.clear();
    audio?.stop();
  };
}

function applyDecision(cand, latency, via, confidence = null) {
  const { game: g, hud } = state();
  const feasible = isFeasible(g, cand);
  update({
    hud: {
      action: feasible ? cand.label : '状況が変わったので考え直すよ。',
      latency,
      via,
      confidence,
      decisions: hud.decisions + 1,
      dropped: hud.dropped + (feasible ? 0 : 1),
    },
  });
  if (feasible) g.ai.intent = { ...cand, startedAt: g.time };
}

async function decide() {
  const { game: g, mode, policy } = state();
  const decisionMs = Number(STAFF[g.staffId]?.decisionMs) || 1800;
  if (
    controller ||
    g.ai.intent ||
    g.time - lastDecision < decisionMs ||
    g.time - policyChangedAt < POLICY_DEBOUNCE_MS
  )
    return;
  lastDecision = g.time;
  const candidates = buildCandidates(g);
  if (candidates.length === 1 || mode === 'rule' || g.time < retryAt) {
    applyDecision(
      rulePick(g, candidates),
      0,
      mode === 'rule' ? '固定ルール' : g.time < retryAt ? '固定ルール（接続待ち）' : '候補1つ',
    );
    return;
  }
  const requestEpoch = epoch,
    requestController = new AbortController();
  controller = requestController;
  const started = performance.now();
  try {
    const observation = observe(g, policy);
    const response = await fetch(mode === 'llm' ? '/api/decide-llm' : '/api/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(5000)]),
      body: JSON.stringify(
        mode === 'llm'
          ? { state: observation, candidates: candidates.map(({ id, label }) => ({ id, label })) }
          : { state: observation, questions: buildQuestions(candidates) },
      ),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error('No decision');
    if (requestEpoch !== epoch || state().phase !== 'playing') return;
    const answer = data.result?.answers?.next_action;
    const candidate = candidates.find((c) => c.id === answer?.choice);
    if (!candidate) throw new Error('Invalid decision');
    update({ fallback: false });
    applyDecision(
      candidate,
      Math.round(performance.now() - started),
      data.via ?? 'Workers AI',
      answer?.confidence,
    );
  } catch {
    if (requestEpoch !== epoch || state().phase !== 'playing') return;
    retryAt = g.time + 10_000;
    update({ fallback: true });
    applyDecision(rulePick(g, buildCandidates(g)), 0, '固定ルール（接続待ち）');
  } finally {
    if (controller === requestController) controller = null;
  }
}

export function tick(delta) {
  if (state().phase !== 'playing') return;
  const g = state().game,
    dt = Math.min(MAX_FRAME_DELTA, Math.max(0, Number.isFinite(delta) ? delta : 0));
  const practice = state().tutorial !== null;
  const missed = g.missed;
  advance(g, dt * 1000);
  if (!practice && g.missed > missed) {
    notify('注文がタイムアウト。次のひと皿で取り返そう！');
    playSound('failure');
  }
  if (!practice && g.time >= g.duration) {
    invalidate();
    keys.clear();
    target = null;
    const best = Math.max(state().best, g.score);
    const cleared = g.served >= (Number.isFinite(g.quota) ? g.quota : quotaForLevel(g.level));
    const campaignComplete = cleared && g.level >= MAX_LEVEL;
    const applicants = cleared && !campaignComplete ? drawApplicants(g.hired ?? []) : [];
    const checkpoint = campaignComplete
      ? writeCheckpoint(shiftSnapshot ?? snapshot(g), true)
      : state().checkpoint;
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch {
      /* Private browsing can disable storage. */
    }
    update({ phase: 'finished', best, cleared, applicants, campaignComplete, checkpoint });
    playSound('finish');
    publish();
    return;
  }
  if (practice && state().tutorial === TUTORIAL_STEPS.length) {
    keys.clear();
    target = null;
    if (g.time - lastPublish >= 100) {
      lastPublish = g.time;
      publish();
    }
    return;
  }
  const ax =
    Number(keys.has('d') || keys.has('arrowright')) -
    Number(keys.has('a') || keys.has('arrowleft'));
  const ay =
    Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
  const step = SPEED * dt * (g.time < g.human.dashUntil ? 2.7 : 1);
  const bounds = kitchenBounds(g);
  if (ax || ay) {
    const length = Math.hypot(ax, ay);
    // Camera-relative movement: right stays right in the isometric view.
    g.human.x = Math.max(
      bounds.minX,
      Math.min(bounds.maxX, g.human.x + ((ax * 0.874 + ay * 0.486) / length) * step),
    );
    g.human.y = Math.max(
      bounds.minY,
      Math.min(bounds.maxY, g.human.y + ((-ax * 0.486 + ay * 0.874) / length) * step),
    );
  } else if (target) {
    const station = STATIONS[target];
    if (moveToward(g.human, station.x, station.y, step)) humanInteract(true);
  }
  if (practice && state().tutorial === TUTORIAL_STEPS.length) {
    keys.clear();
    target = null;
    if (g.time - lastPublish >= 100) {
      lastPublish = g.time;
      publish();
    }
    return;
  }
  for (const who of ['human', 'ai']) {
    const near = stationAt(g, who);
    g[who].station = near.inReach ? near.id : null;
  }
  const intent = g.ai.intent;
  if (intent) {
    if (intent.id === 'wait') {
      const decisionMs = Number(STAFF[g.staffId]?.decisionMs) || 1800;
      if (g.time - intent.startedAt > decisionMs) g.ai.intent = null;
    } else if (!isFeasible(g, intent)) {
      g.ai.intent = null;
    } else if (intent.id === 'discard') {
      discard(g, 'ai');
      g.ai.intent = null;
    } else {
      const station = STATIONS[intent.station];
      const staff = STAFF[g.staffId] ?? STAFF.helper;
      g.ai.dashUntil ??= 0;
      g.ai.dashReadyAt ??= 0;
      if (staff.canDash && g.time >= g.ai.dashReadyAt && g.time >= g.ai.dashUntil) {
        g.ai.dashUntil = g.time + 220;
        g.ai.dashReadyAt = g.time + 1800;
      }
      const partnerSpeed = staff.speed;
      const dashSpeed = g.time < g.ai.dashUntil ? 2.7 : 1;
      if (moveToward(g.ai, station.x, station.y, SPEED * dt * 0.9 * partnerSpeed * dashSpeed)) {
        if (isFeasible(g, intent)) {
          const result = interact(g, 'ai', intent.station);
          if (result.ok) record('ai', result);
        }
        g.ai.intent = null;
      }
    }
  }
  if (!practice) void decide();
  if (g.time - lastPublish >= 100) {
    lastPublish = g.time;
    publish();
  }
}
