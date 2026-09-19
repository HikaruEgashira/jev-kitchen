import { create } from 'zustand';
import {
  createGame,
  stationAt,
  interact,
  buildCandidates,
  isFeasible,
  buildQuestions,
  rulePick,
  observe,
  discard,
  dash,
  STATIONS,
  activeStationIds,
  quotaForLevel,
  levelConfig,
  MAX_LEVEL,
  actor,
  resolveLayout,
  handoffOption,
  handoff,
} from './model.js';
import { createAudio } from './audio.js';
import { apiFetch } from './api-client.js';
import { drawApplicants } from './applicants.js';
import { tickWorld } from './engine.js';
import { nextShiftParams } from './nextShift.js';
import { STAFF, nextStaffState, staffAvailable } from './staff.js';
import { equipmentState, validateEquipment } from './equipment.js';
import { trainingState, validateTraining } from './training.js';

const BEST_KEY = 'sidekick-best-v2';
export const CHECKPOINT_KEY = 'sidekick-campaign-v1';
export const STAGES_KEY = 'sidekick-stages-v1';
const CHECKPOINT_VERSION = 5;
const STARTING_CASH = 180;

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

function normalizeRollbackEntry(value, allowUnreadyStock = false, version = CHECKPOINT_VERSION) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value.snapshot ?? value;
  // Keep the nested `rollback` so a previous-stage rewind can offer the same
  // recovery choices (review / further previous) when that stage fails.
  const snapshot = validateCheckpoint(
    { ...source, version: source.version ?? version, completed: false },
    true,
    allowUnreadyStock,
  );
  if (!snapshot) return null;
  const applicants = value.snapshot
    ? Array.isArray(value.applicants)
      ? [...new Set(value.applicants)].filter((id) => Object.hasOwn(STAFF, id))
      : []
    : [];
  return { snapshot, applicants };
}

function validateCheckpoint(value, includeRollback = true, allowUnreadyStock = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version === 1) {
    value = {
      ...value,
      version: 2,
      duty: [value.staffId],
      frozenApplicants: null,
      staffState: Object.fromEntries(
        (Array.isArray(value.hired) ? value.hired : []).map((id) => [id, { worked: 0, rest: 0 }]),
      ),
    };
  }
  const sourceVersion = value.version;
  const legacy = sourceVersion === 2;
  if (legacy || sourceVersion === 3 || sourceVersion === 4)
    value = { ...value, version: CHECKPOINT_VERSION };
  if (value.version !== CHECKPOINT_VERSION || typeof value.completed !== 'boolean') return null;
  if (!Number.isSafeInteger(value.level) || value.level < 1 || value.level > MAX_LEVEL) return null;
  if (value.equipment !== undefined && !validateEquipment(value.equipment, value.level))
    return null;
  const equipment = equipmentState(value.equipment);
  const layout = resolveLayout({ level: value.level, equipment }, value.layout);
  if (!layout) return null;
  if (!safeMoney(value.cash) || !safeStock(value.stock)) return null;
  // Balance changes must not erase a valid paid opening or its rewind history.
  if (legacy) {
    const oldQuota =
      value.level <= 30
        ? 6 + Math.floor(value.level / 5)
        : 12 + Math.round(2 * Math.sqrt((value.level - 30) / 70));
    if (value.stock !== null && value.stock >= oldQuota)
      value.stock = Math.max(value.stock, quotaForLevel(value.level));
    if (value.level === 1) {
      value.duty = [];
      value.cash = Math.max(STARTING_CASH, value.cash);
    }
    if (value.staffState?.veteran?.worked === 1)
      value.staffState = {
        ...value.staffState,
        veteran: { ...value.staffState.veteran, worked: 0 },
      };
  }
  if (
    (sourceVersion === 3 || sourceVersion === 4) &&
    value.level >= 5 &&
    value.level <= 7 &&
    value.stock >= 9
  )
    value.stock = Math.max(value.stock, quotaForLevel(value.level));
  if ((value.level === 1) !== (value.stock === null)) return null;
  if (!allowUnreadyStock && value.level > 1 && value.stock < quotaForLevel(value.level))
    return null;
  if (!Array.isArray(value.hired) || value.hired.length === 0) return null;
  if (new Set(value.hired).size !== value.hired.length) return null;
  if (
    !value.hired.every((id) => typeof id === 'string' && Object.hasOwn(STAFF, id)) ||
    !value.hired.includes('helper')
  )
    return null;
  if (!Array.isArray(value.duty) || new Set(value.duty).size !== value.duty.length) return null;
  const staffSlots = levelConfig(value.level).staffSlots;
  if (Number.isSafeInteger(staffSlots) && value.duty.length > staffSlots) return null;
  if (!value.staffState || typeof value.staffState !== 'object') return null;
  for (const id of value.hired) {
    const status = value.staffState[id];
    const profile =
      id === 'veteran' && sourceVersion === 3 ? { maxConsecutive: 1, restShifts: 5 } : STAFF[id];
    if (
      !status ||
      !Number.isInteger(status.worked) ||
      status.worked < 0 ||
      status.worked >= profile.maxConsecutive ||
      !Number.isInteger(status.rest) ||
      status.rest < 0 ||
      status.rest > profile.restShifts ||
      (status.rest > 0 && status.worked !== 0) ||
      ((id !== 'veteran' || sourceVersion >= 4) &&
        !levelConfig(value.level).fatigueEnabled &&
        (status.rest !== 0 || status.worked !== 0))
    )
      return null;
  }
  if (!value.duty.every((id) => value.hired.includes(id) && staffAvailable(value.staffState, id)))
    return null;
  if (sourceVersion < 4) {
    const partner = levelConfig(value.level).partner;
    const hired = value.hired.filter(
      (id) => sourceVersion !== 3 || value.level <= 3 || id !== 'veteran',
    );
    if (partner && !hired.includes(partner)) hired.push(partner);
    const duty = partner ? [partner] : value.duty.filter((id) => hired.includes(id));
    if (
      !duty.length &&
      value.duty.includes('veteran') &&
      staffAvailable(value.staffState, 'helper')
    )
      duty.push('helper');
    value = {
      ...value,
      hired,
      duty,
      staffState: {
        ...value.staffState,
        ...(partner ? { [partner]: { worked: 0, rest: 0 } } : {}),
      },
    };
  }
  const frozenApplicants =
    value.frozenApplicants == null
      ? null
      : Array.isArray(value.frozenApplicants) &&
          new Set(value.frozenApplicants).size === value.frozenApplicants.length &&
          value.frozenApplicants.every((id) => typeof id === 'string' && Object.hasOwn(STAFF, id))
        ? [...value.frozenApplicants]
        : null;
  if (value.frozenApplicants != null && frozenApplicants == null) return null;
  const training = validateTraining(value.training, value.hired);
  if (training === null) return null;
  const record = {
    version: CHECKPOINT_VERSION,
    level: value.level,
    cash: value.cash,
    stock: value.stock,
    duty: [...value.duty],
    staffState: Object.fromEntries(value.hired.map((id) => [id, { ...value.staffState[id] }])),
    hired: [...value.hired],
    equipment,
    training,
    layout,
    completed: value.completed,
    frozenApplicants,
  };
  if (!includeRollback) return record;
  if (value.rollback == null) return { ...record, rollback: null };
  if (typeof value.rollback !== 'object' || Array.isArray(value.rollback)) return null;
  const preparation = value.rollback.preparation
    ? normalizeRollbackEntry(value.rollback.preparation, true, sourceVersion)
    : null;
  const previous = value.rollback.previous
    ? normalizeRollbackEntry(value.rollback.previous, false, sourceVersion)
    : null;
  if ((value.rollback.preparation && !preparation) || (value.rollback.previous && !previous))
    return null;
  return { ...record, rollback: { preparation, previous } };
}

function readCheckpoint() {
  try {
    const raw = globalThis.localStorage?.getItem(CHECKPOINT_KEY);
    return typeof raw === 'string' ? validateCheckpoint(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// Archive each paid opening once; replaying an earlier stage never replaces a later one.
function archiveEntry(record) {
  const previous = record.rollback?.previous;
  return {
    ...record,
    rollback: record.rollback
      ? {
          ...record.rollback,
          previous: previous
            ? { ...previous, snapshot: { ...previous.snapshot, rollback: null } }
            : null,
        }
      : null,
  };
}

function readStages(checkpoint, fallback = {}) {
  const stages = { ...fallback };
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STAGES_KEY) ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      for (const [level, value] of Object.entries(saved)) {
        const record = validateCheckpoint(value);
        if (record && String(record.level) === level) stages[level] = archiveEntry(record);
      }
  } catch {
    /* Keep valid legacy and in-memory saves if storage is unavailable. */
  }
  for (let record = checkpoint; record; record = record.rollback?.previous?.snapshot) {
    stages[record.level] ??= archiveEntry(record);
    const previous = record.rollback?.previous;
    if (previous && stages[previous.snapshot.level]?.frozenApplicants == null)
      stages[previous.snapshot.level] = archiveEntry({
        ...previous.snapshot,
        frozenApplicants: previous.applicants,
      });
  }
  return stages;
}

function writeCheckpoint(value, completed = false) {
  if (state().benchmark) return null;
  const record = validateCheckpoint({ ...value, version: CHECKPOINT_VERSION, completed });
  if (!record) return null;
  const stages = readStages(readCheckpoint(), state().stages);
  // Import the old rewind chain before changing the current continuation point.
  Object.assign(stages, readStages(record, stages));
  stages[record.level] ??= archiveEntry(record);
  if (completed) stages[record.level] = { ...stages[record.level], completed: true };
  update({ stages });
  try {
    globalThis.localStorage?.setItem(STAGES_KEY, JSON.stringify(stages));
    globalThis.localStorage?.setItem(CHECKPOINT_KEY, JSON.stringify(record));
  } catch {
    /* Storage is optional; the in-memory checkpoint still protects this session. */
  }
  return record;
}

const initialCheckpoint = readCheckpoint();

const freshState = (checkpoint) => ({
  game:
    checkpoint && !checkpoint.completed
      ? createGame(checkpoint)
      : createGame({ cash: STARTING_CASH }),
  phase: 'ready',
  benchmark: false,
  autoMode: false,
  autoStatus: '',
  benchPreparation: null,
  benchFeedback: null,
  preparationPreview: null,
  revision: 0,
  mode: 'jev',
  policy: '',
  backend: '準備中',
  ready: false,
  menuOpen: false,
  menuPage: null,
  cameraMode: 'auto',
  movementMode: 'grid',
  sound: true,
  backgroundMode: true,
  best: savedBest(),
  checkpoint,
  stages: readStages(checkpoint),
  rollback: checkpoint?.rollback ?? null,
  reviewing: false,
  cleared: false,
  applicants: [],
  campaignComplete: false,
  tutorial: null,
  toast: '',
  toastUntil: 0,
  celebration: 0,
  lastPoints: 0,
  movingTo: null,
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
});

export const useKitchen = create(() => freshState(initialCheckpoint));

const keys = new Set();
let target = null,
  epoch = 0,
  policyChangedAt = -Infinity,
  retryAt = 0,
  lastPublish = 0;
const decisions = new Map();
let audio;
const MODES = new Set(['jev', 'rule', 'llm']);
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
let frozenApplicants = null;
let applicantsRandom = null;

/** Ranked runs seed the applicant draw so the server replays the same hires. */
export function setApplicantsRandom(random) {
  applicantsRandom = typeof random === 'function' ? random : null;
}

function playSound(kind) {
  if (!state().sound) return;
  audio ??= createAudio();
  audio.play(kind);
}

function invalidate() {
  epoch++;
  for (const decision of decisions.values()) decision.controller?.abort();
  decisions.clear();
  const game = state().game;
  if (game?.human) game.human.intent = null;
  for (const cook of Object.values(game?.crew ?? {})) cook.intent = null;
}

function publish() {
  update({ revision: state().revision + 1, movingTo: target });
}

function notify(text) {
  update({ toast: text, toastUntil: state().game.time + 2400 });
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
  return {
    level,
    cash: safeMoney(g.cash) ? g.cash : STARTING_CASH,
    stock: level === 1 ? null : Number.isSafeInteger(g.stock) && g.stock >= 0 ? g.stock : 0,
    duty: [...g.duty],
    staffState: Object.fromEntries(hired.map((id) => [id, { ...g.staffState[id] }])),
    hired,
    equipment: equipmentState(g.equipment),
    training: trainingState(g.training),
    layout: { ...g.layout },
  };
}

function record(who, result) {
  const g = state().game,
    cook = actor(g, who);
  cook.action = result.action;
  if (cook.lastActions)
    cook.lastActions = [
      ...cook.lastActions.slice(-5),
      { t: g.time, label: result.action, stock: g.stock, served: g.served },
    ];
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
  level = 1,
  cash = STARTING_CASH,
  duty = ['helper'],
  staffState,
  hired = ['helper'],
  stock = null,
  equipment,
  layout,
  training,
  rollback = null,
  frozenApplicants: successorApplicants = null,
} = {}) {
  invalidate();
  keys.clear();
  target = null;
  retryAt = 0;
  lastPublish = 0;
  policyChangedAt = -Infinity;
  frozenApplicants = Array.isArray(successorApplicants) ? [...successorApplicants] : null;
  const game = createGame({
    level,
    cash,
    duty,
    staffState,
    hired,
    stock,
    equipment,
    layout,
    training,
  });
  const checkpoint = writeCheckpoint({ ...snapshot(game), rollback, frozenApplicants });
  shiftSnapshot = checkpoint;
  update({
    game,
    benchPreparation: null,
    benchFeedback: null,
    preparationPreview: null,
    phase: 'playing',
    tutorial: game.practice && !state().benchmark && !state().autoMode ? 0 : null,
    cleared: false,
    applicants: [],
    campaignComplete: false,
    checkpoint,
    rollback: checkpoint?.rollback ?? null,
    reviewing: false,
    log: [],
    toast: '',
    toastUntil: 0,
    celebration: 0,
    fallback: false,
    lastPoints: 0,
    hud: {
      action: game.practice ? TUTORIAL_STEPS[0].label : 'さあ、最初の注文を作ろう！',
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
  if (!state().ready || state().menuOpen) return;
  const saved = state().phase === 'ready' ? readCheckpoint() : null;
  update({ benchmark: false, checkpoint: saved });
  if (saved && !saved.completed) {
    beginShift(saved);
  } else {
    beginShift();
  }
}

// Benchmark campaigns use normal mechanics without persistent game writes.
export function startBenchmark() {
  if (!state().ready) return false;
  update({ benchmark: true, menuOpen: false, mode: 'rule', policy: '', sound: false });
  beginShift();
  return true;
}

export function benchmarkAction(candidate) {
  const { game, phase, benchmark, autoMode } = state();
  if ((!benchmark && !autoMode) || phase !== 'playing' || !isFeasible(game, candidate, 'human'))
    return false;
  const selected = buildCandidates(game, 'human').find((c) => c.id === candidate.id);
  if (selected.id === 'continue') return true;
  if (selected.id === 'dash') return dash(game);
  if (selected.dash) {
    if (!dash(game)) return false;
    selected.id = selected.baseId;
  }
  if (selected.id === 'interact' || selected.partner) {
    game.human.intent = null;
    humanInteract(false, false, true);
    return true;
  }
  if (selected.id.startsWith('visit_')) {
    const near = stationAt(game, 'human');
    selected.automatic = !(near.inReach && near.id === selected.station);
  }
  game.human.intent = { ...selected, startedAt: game.time };
  return true;
}

export function setAutoMode(enabled) {
  if (state().benchmark) return;
  invalidate();
  keys.clear();
  target = null;
  update({ autoMode: Boolean(enabled), autoStatus: '', ...(enabled ? { tutorial: null } : {}) });
}

export function togglePause() {
  const phase = state().phase;
  if ((phase !== 'playing' && phase !== 'paused') || !state().ready || state().menuOpen) return;
  invalidate();
  keys.clear();
  target = null;
  const nextPhase = phase === 'playing' ? 'paused' : 'playing';
  update({ phase: nextPhase });
  if (nextPhase === 'paused') audio?.stop();
}

export function setMenuOpen(open) {
  if (open && state().phase === 'playing') togglePause();
  keys.clear();
  target = null;
  // Reopening the menu always starts at the first page.
  update({ menuOpen: Boolean(open), ...(open ? { menuPage: null } : {}) });
}

/** Wipe saved progress and return to a brand-new Lv1 kitchen. */
export function resetGame() {
  const current = state();
  invalidate();
  keys.clear();
  target = null;
  shiftSnapshot = null;
  frozenApplicants = null;
  applicantsRandom = null;
  retryAt = 0;
  policyChangedAt = -Infinity;
  lastPublish = 0;
  audio?.stop();
  try {
    for (const key of [BEST_KEY, CHECKPOINT_KEY, STAGES_KEY])
      globalThis.localStorage?.removeItem(key);
  } catch {
    /* Storage is optional; the in-memory reset still applies. */
  }
  update({
    ...freshState(null),
    best: 0,
    stages: {},
    ready: current.ready,
    revision: current.revision + 1,
  });
}

const MENU_PAGES = new Set(['settings', 'help', 'controls', 'diagnostics', 'hints', 'stages']);

export function setMenuPage(menuPage) {
  if (menuPage === null || MENU_PAGES.has(menuPage)) update({ menuPage });
}

export function setCameraMode(cameraMode) {
  if (['auto', 'follow', 'overview'].includes(cameraMode)) update({ cameraMode });
}

export function restoreStage(level) {
  const current = state();
  if (
    !current.ready ||
    current.benchmark ||
    !['ready', 'paused', 'finished'].includes(current.phase)
  )
    return false;
  const stages = readStages(readCheckpoint(), current.stages);
  const saved = Number.isInteger(level) ? stages[level] : null;
  if (!saved) return false;
  update({ stages, menuOpen: false, menuPage: null });
  beginShift(saved);
  return true;
}

export function setMovementMode(movementMode) {
  if (movementMode === 'screen' || movementMode === 'grid') update({ movementMode });
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

export function nextShift(
  applicantId = null,
  buyStock,
  assignedDuty,
  equipmentPurchases = [],
  layout,
  vitamins = [],
) {
  const current = state();
  if (
    !current.ready ||
    current.menuOpen ||
    current.phase !== 'finished' ||
    !current.cleared ||
    current.campaignComplete
  )
    return false;
  const g = current.game;
  const applicants = Array.isArray(current.applicants) ? current.applicants : [];
  const previous = shiftSnapshot ? normalizeRollbackEntry(shiftSnapshot) : null;
  const rollback = {
    preparation: { snapshot: snapshot(g), applicants },
    previous: previous ? { snapshot: previous.snapshot, applicants } : null,
  };
  const params = nextShiftParams(g, {
    applicants,
    applicantId,
    buyStock,
    assignedDuty,
    equipmentPurchases,
    layout,
    vitamins,
  });
  if (!params) return false;
  beginShift({ ...params, rollback });
  return true;
}

export function setPreparationPreview(preview) {
  const current = state();
  if (preview === null) {
    if (current.preparationPreview) update({ preparationPreview: null });
    return;
  }
  if (!current.ready || current.phase !== 'finished' || !current.cleared) return;
  const level = Math.min(MAX_LEVEL, current.game.level + 1);
  if (!preview || !validateEquipment(preview.equipment, level)) return;
  const layout = resolveLayout({ level, equipment: preview.equipment }, preview.layout);
  if (!layout) return;
  update({ preparationPreview: { ...current.game, level, equipment: preview.equipment, layout } });
}

export function retryShift() {
  const current = state();
  if (
    !current.ready ||
    current.menuOpen ||
    current.phase !== 'finished' ||
    current.cleared ||
    !shiftSnapshot
  )
    return false;
  beginShift({ ...shiftSnapshot });
  return true;
}

export function rollbackToPreparation() {
  const current = state();
  const preparation = current.rollback?.preparation;
  if (
    !current.ready ||
    current.menuOpen ||
    current.phase !== 'finished' ||
    current.cleared ||
    !preparation
  )
    return false;
  const game = createGame(preparation.snapshot);
  const previous = current.rollback?.previous?.snapshot;
  const checkpoint = writeCheckpoint({
    ...(previous ?? preparation.snapshot),
    frozenApplicants: preparation.applicants,
  });
  if (!checkpoint) return false;
  invalidate();
  shiftSnapshot = checkpoint;
  update({
    game,
    preparationPreview: null,
    phase: 'finished',
    cleared: true,
    applicants: [...preparation.applicants],
    campaignComplete: false,
    checkpoint,
    rollback: null,
    reviewing: true,
    toast: '開店準備をやり直せます',
  });
  publish();
  return true;
}

export function rollbackToPreviousStage() {
  const current = state();
  const previous = current.rollback?.previous;
  if (
    !current.ready ||
    current.menuOpen ||
    !previous?.snapshot ||
    current.phase !== 'finished' ||
    current.cleared
  )
    return false;
  if (previous.snapshot.level >= current.game.level) return false;
  beginShift({
    ...previous.snapshot,
    rollback: previous.snapshot.rollback ?? null,
    frozenApplicants: previous.applicants,
  });
  return true;
}

export function toggleSound() {
  const sound = !state().sound;
  update({ sound });
  audio?.setEnabled(sound);
}

export function toggleBackgroundMode() {
  update({ backgroundMode: !state().backgroundMode });
}

function tutorialStep() {
  const step = state().tutorial;
  return Number.isInteger(step) && step >= 0 && step < TUTORIAL_STEPS.length ? step : null;
}

export function goTo(id) {
  const current = state();
  if (current.phase !== 'playing' || current.menuOpen || current.autoMode || !STATIONS[id]) return;
  if (!activeStationIds(current.game).includes(id)) return;
  const step = tutorialStep();
  if (state().tutorial === TUTORIAL_STEPS.length) return;
  if (step !== null && TUTORIAL_STEPS[step].station !== id) {
    notify(`次は「${TUTORIAL_STEPS[step].label}」`);
    return;
  }
  const near = stationAt(current.game, 'human');
  if (near.inReach && near.id === id) {
    humanInteract(false, true);
    if (state().tutorial === 3 && current.game.stations.board.state === 'chopping') target = id;
    return;
  }
  current.game.human.intent = null;
  target = id;
  publish();
}

export function humanInteract(automatic = false, stationOnly = false, automated = false) {
  if (state().autoMode && !automated) return;
  if (state().phase !== 'playing') return;
  const g = state().game,
    near = stationAt(g, 'human');
  const step = tutorialStep();
  if (state().tutorial === TUTORIAL_STEPS.length) return;
  const transfer = !automatic && !stationOnly && step === null && handoffOption(g);
  if (transfer) {
    target = null;
    const result = handoff(g, transfer.partner);
    if (result.ok) record('human', result);
    return;
  }
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
        update({ tutorial: null });
        finishShift();
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
  if (state().autoMode || state().phase !== 'playing' || state().tutorial !== null) return;
  if (discard(state().game, 'human')) {
    notify('手を空けたよ。コンボはリセット');
    publish();
  }
}

export function humanDash() {
  if (!state().autoMode && state().phase === 'playing' && dash(state().game)) playSound('dash');
}

export function installControls() {
  const typing = (e) => e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  const down = (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (e.repeat) return;
      if (state().menuOpen) {
        setMenuOpen(false);
        return;
      }
      togglePause();
      return;
    }
    if (state().phase !== 'playing' || state().autoMode) return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      e.preventDefault();
      state().game.human.intent = null;
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
    if (!state().backgroundMode && state().phase === 'playing') togglePause();
  };
  const visibility = () => {
    if (!state().backgroundMode && document.hidden && state().phase === 'playing') togglePause();
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

function applyDecision(who, cand, latency, via, confidence = null) {
  const { game: g, hud } = state();
  const feasible = isFeasible(g, cand, who);
  update({
    hud: {
      action: `${STAFF[who].name}：${feasible ? cand.label : '状況が変わったので考え直すよ。'}`,
      latency,
      via,
      confidence,
      decisions: hud.decisions + 1,
      dropped: hud.dropped + (feasible ? 0 : 1),
    },
  });
  if (feasible) g.crew[who].intent = { ...cand, startedAt: g.time };
}

async function decide(who) {
  const { game: g, mode, policy } = state();
  const decisionMs = STAFF[who].decisionMs;
  const decision = decisions.get(who) ?? { controller: null, lastDecision: -Infinity };
  if (
    decision.controller ||
    g.crew[who].intent ||
    g.time - decision.lastDecision < decisionMs ||
    g.time - policyChangedAt < POLICY_DEBOUNCE_MS
  )
    return;
  decision.lastDecision = g.time;
  decisions.set(who, decision);
  const candidates = buildCandidates(g, who);
  if (candidates.length === 1 || mode === 'rule' || g.time < retryAt) {
    applyDecision(
      who,
      rulePick(g, candidates, who),
      0,
      mode === 'rule' ? '固定ルール' : g.time < retryAt ? '固定ルール（接続待ち）' : '候補1つ',
    );
    return;
  }
  const requestEpoch = epoch,
    requestController = new AbortController();
  decision.controller = requestController;
  const started = performance.now();
  try {
    const observation = observe(g, policy, who);
    const response = await apiFetch(
      mode === 'llm' ? '/api/decide-llm' : '/api/decide',
      mode === 'llm'
        ? { state: observation, candidates: candidates.map(({ id, label }) => ({ id, label })) }
        : { state: observation, questions: buildQuestions(candidates) },
      'play',
      { signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(5000)]) },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error('No decision');
    if (requestEpoch !== epoch || state().phase !== 'playing') return;
    const answer = data.result?.answers?.next_action;
    const candidate = candidates.find((c) => c.id === answer?.choice);
    if (!candidate) throw new Error('Invalid decision');
    update({ fallback: false });
    applyDecision(
      who,
      candidate,
      Math.round(performance.now() - started),
      data.via ?? 'Workers AI',
      answer?.confidence,
    );
  } catch {
    if (requestEpoch !== epoch || state().phase !== 'playing') return;
    retryAt = g.time + 10_000;
    update({ fallback: true });
    applyDecision(who, rulePick(g, buildCandidates(g, who), who), 0, '固定ルール（接続待ち）');
  } finally {
    if (decision.controller === requestController) decision.controller = null;
  }
}

function finishShift() {
  const g = state().game;
  invalidate();
  keys.clear();
  target = null;
  const best = Math.max(state().best, g.score);
  const cleared = g.served >= (Number.isFinite(g.quota) ? g.quota : quotaForLevel(g.level));
  const campaignComplete = cleared && g.level >= MAX_LEVEL;
  const applicants =
    cleared && !campaignComplete && g.level >= 3
      ? frozenApplicants
        ? [...frozenApplicants]
        : drawApplicants(Object.keys(nextStaffState(g)), applicantsRandom ?? undefined)
      : [];
  const checkpoint = campaignComplete
    ? writeCheckpoint(shiftSnapshot ?? snapshot(g), true)
    : state().checkpoint;
  try {
    if (!state().benchmark) localStorage.setItem(BEST_KEY, String(best));
  } catch {
    /* Private browsing can disable storage. */
  }
  if (cleared) frozenApplicants = null;
  update({ phase: 'finished', best, cleared, applicants, campaignComplete, checkpoint });
  if (cleared) playSound('success');
  playSound(cleared ? 'applause' : 'finish');
  publish();
}

export function tick(delta) {
  if (state().phase !== 'playing') return;
  const g = state().game;
  const previousSeconds = Math.ceil((g.duration - g.time) / 1000);
  const { missed, finished } = tickWorld(g, delta, {
    ax:
      Number(keys.has('d') || keys.has('arrowright')) -
      Number(keys.has('a') || keys.has('arrowleft')),
    ay:
      Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')),
    target,
    movementMode: state().movementMode,
    benchmark: state().benchmark || state().autoMode,
    stillPlaying: () => state().phase === 'playing',
    onTargetArrive: () => humanInteract(true),
    onHumanArrive: (intent) => humanInteract(intent.automatic, true, true),
    onRecord: record,
  });
  const seconds = Math.ceil((g.duration - g.time) / 1000);
  if (!g.practice && seconds >= 1 && seconds <= 5 && seconds < previousSeconds)
    playSound('countdown');
  if (missed && !g.practice) {
    notify('お客さまをお待たせしました。');
    playSound('failure');
  }
  if (finished) {
    finishShift();
    return;
  }
  if (!g.practice) for (const who of g.duty) void decide(who);
  if (g.time - lastPublish >= 100) {
    lastPublish = g.time;
    publish();
  }
}
