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
  SPEED,
  SHIFT_MS,
} from './model.js';
import { createAudio } from './audio.js';

function savedBest() {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(localStorage.getItem('sidekick-best'));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export const useKitchen = create(() => ({
  game: createGame(),
  phase: 'ready',
  revision: 0,
  mode: 'jev',
  policy: '',
  backend: '準備中',
  ready: false,
  sound: true,
  best: savedBest(),
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
  lastDecision = -1000,
  retryAt = 0,
  lastPublish = 0;
let audio;
const MODES = new Set(['jev', 'rule', 'llm']);
// Keep 1 FPS timing honest; visibility and blur pause longer stalls.
const MAX_FRAME_DELTA = 1;
export const TUTORIAL_STEPS = Object.freeze([
  Object.freeze({ station: 'crate', label: 'トマトをとる', icon: '🍅' }),
  Object.freeze({ station: 'board', label: '切る', icon: '🔪' }),
  Object.freeze({ station: 'plates', label: 'お皿をとる', icon: '🍽️' }),
  Object.freeze({ station: 'board', label: '盛る', icon: '🥗' }),
  Object.freeze({ station: 'serve', label: 'とどける', icon: '✨' }),
]);
const state = useKitchen.getState;
const update = useKitchen.setState;

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
  lastDecision = -1000;
}

function publish() {
  update({ revision: state().revision + 1 });
}

function notify(text) {
  update({ toast: text, toastUntil: state().game.time + 2400 });
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
  } else if (who === 'human') playSound('action');
  publish();
}

function beginShift(practice) {
  invalidate();
  keys.clear();
  target = null;
  retryAt = 0;
  lastPublish = 0;
  update({
    game: createGame({ practice }),
    phase: 'playing',
    tutorial: practice ? 0 : null,
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
  if (state().ready) beginShift(false);
}

export function startTutorial() {
  if (state().ready) beginShift(true);
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
  lastDecision = state().game.time;
  update({ policy: typeof policy === 'string' ? policy.slice(0, 300) : '' });
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
  if (state().phase !== 'playing' || !STATIONS[id]) return;
  const step = tutorialStep();
  if (state().tutorial === TUTORIAL_STEPS.length) return;
  if (step !== null && TUTORIAL_STEPS[step].station !== id) {
    notify(`次は「${TUTORIAL_STEPS[step].label}」`);
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
  target = null;
  const result = interact(g, 'human', near.id);
  if (result.ok) {
    record('human', result);
    if (step !== null && state().tutorial === step) {
      const next = step + 1;
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
  if (controller || g.ai.intent || g.time - lastDecision < 420) return;
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
  if (!practice && g.time >= SHIFT_MS) {
    invalidate();
    keys.clear();
    target = null;
    const best = Math.max(state().best, g.score);
    try {
      localStorage.setItem('sidekick-best', String(best));
    } catch {
      /* Private browsing can disable storage. */
    }
    update({ phase: 'finished', best });
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
  if (ax || ay) {
    const length = Math.hypot(ax, ay);
    // Camera-relative movement: right stays right in the isometric view.
    g.human.x = Math.max(
      85,
      Math.min(775, g.human.x + ((ax * 0.874 + ay * 0.486) / length) * step),
    );
    g.human.y = Math.max(
      175,
      Math.min(402, g.human.y + ((-ax * 0.486 + ay * 0.874) / length) * step),
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
      if (g.time - intent.startedAt > 600) g.ai.intent = null;
    } else if (!isFeasible(g, intent)) {
      g.ai.intent = null;
    } else if (intent.id === 'discard') {
      discard(g, 'ai');
      g.ai.intent = null;
    } else {
      const station = STATIONS[intent.station];
      if (moveToward(g.ai, station.x, station.y, SPEED * dt * 0.9)) {
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
