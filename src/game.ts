import { create } from 'zustand';
import type {
  ActionResult,
  Candidate,
  CameraMode,
  Checkpoint,
  CheckpointRollback,
  GameState,
  Mode,
  MovementMode,
  RollbackLink,
  Snapshot,
  StaffState,
  StoreState,
} from './types.ts';
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
} from './model.ts';
import { createAudio } from './audio.ts';
import { apiFetch } from './api-client.ts';
import { drawApplicants } from './applicants.ts';
import { tickWorld } from './engine.ts';
import { nextShiftParams } from './nextShift.ts';
import { STAFF, nextStaffState, staffAvailable } from './staff.ts';
import { equipmentState, validateEquipment } from './equipment.ts';
import { trainingState, validateTraining } from './training.ts';

const BEST_KEY = 'sidekick-best-v2';
export const CHECKPOINT_KEY = 'sidekick-campaign-v1';
export const STAGES_KEY = 'sidekick-stages-v1';
const CHECKPOINT_VERSION = 5;
const STARTING_CASH = 180;

/**
 * Persisted checkpoint before validation. Fields are assumed from storage and
 * every guard below re-checks the runtime value, so the cast is the trust
 * boundary rather than a promise the data is well formed.
 */
interface RawCheckpoint {
  version: number;
  completed: boolean;
  level: number;
  cash: number;
  stock: number | null;
  duty: string[];
  staffState: Record<string, StaffState>;
  hired: string[];
  equipment?: unknown;
  training?: unknown;
  layout?: unknown;
  frozenApplicants: string[] | null;
  staffId: string;
  rollback?: { preparation?: unknown; previous?: unknown } | null;
}

function savedBest(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function safeMoney(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeStock(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function normalizeRollbackEntry(
  value: unknown,
  allowUnreadyStock = false,
  version = CHECKPOINT_VERSION,
): RollbackLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const container = value as { snapshot?: unknown; applicants?: unknown; version?: number };
  const source = container.snapshot ?? value;
  // Keep the nested `rollback` so a previous-stage rewind can offer the same
  // recovery choices (review / further previous) when that stage fails.
  const snapshot = validateCheckpoint(
    {
      ...(source as object),
      version: container.version ?? version,
      completed: false,
    },
    true,
    allowUnreadyStock,
  );
  if (!snapshot) return null;
  const applicants = container.snapshot
    ? Array.isArray(container.applicants)
      ? [...new Set(container.applicants)].filter(
          (id): id is string => typeof id === 'string' && Object.hasOwn(STAFF, id),
        )
      : []
    : [];
  return { snapshot, applicants };
}

function validateCheckpoint(
  value: unknown,
  includeRollback = true,
  allowUnreadyStock = false,
): Checkpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let raw = value as RawCheckpoint;
  if (raw.version === 1) {
    raw = {
      ...raw,
      version: 2,
      duty: [raw.staffId],
      frozenApplicants: null,
      staffState: Object.fromEntries(
        (Array.isArray(raw.hired) ? raw.hired : []).map((id) => [id, { worked: 0, rest: 0 }]),
      ),
    };
  }
  const sourceVersion = raw.version;
  const legacy = sourceVersion === 2;
  if (legacy || sourceVersion === 3 || sourceVersion === 4)
    raw = { ...raw, version: CHECKPOINT_VERSION };
  if (raw.version !== CHECKPOINT_VERSION || typeof raw.completed !== 'boolean') return null;
  if (!Number.isSafeInteger(raw.level) || raw.level < 1 || raw.level > MAX_LEVEL) return null;
  if (raw.equipment !== undefined && !validateEquipment(raw.equipment, raw.level)) return null;
  const equipment = equipmentState(raw.equipment);
  const layout = resolveLayout({ level: raw.level, equipment }, raw.layout);
  if (!layout) return null;
  if (!safeMoney(raw.cash) || !safeStock(raw.stock)) return null;
  // Balance changes must not erase a valid paid opening or its rewind history.
  if (legacy) {
    const oldQuota =
      raw.level <= 30
        ? 6 + Math.floor(raw.level / 5)
        : 12 + Math.round(2 * Math.sqrt((raw.level - 30) / 70));
    if (raw.stock !== null && raw.stock >= oldQuota)
      raw.stock = Math.max(raw.stock, quotaForLevel(raw.level));
    if (raw.level === 1) {
      raw.duty = [];
      raw.cash = Math.max(STARTING_CASH, raw.cash);
    }
    if (raw.staffState?.veteran?.worked === 1)
      raw.staffState = {
        ...raw.staffState,
        veteran: { ...raw.staffState.veteran, worked: 0 },
      };
  }
  if (
    (sourceVersion === 3 || sourceVersion === 4) &&
    raw.level >= 5 &&
    raw.level <= 7 &&
    raw.stock !== null &&
    raw.stock >= 9
  )
    raw.stock = Math.max(raw.stock, quotaForLevel(raw.level));
  if ((raw.level === 1) !== (raw.stock === null)) return null;
  if (!allowUnreadyStock && raw.level > 1 && (raw.stock ?? 0) < quotaForLevel(raw.level))
    return null;
  if (!Array.isArray(raw.hired) || raw.hired.length === 0) return null;
  if (new Set(raw.hired).size !== raw.hired.length) return null;
  if (
    !raw.hired.every((id) => typeof id === 'string' && Object.hasOwn(STAFF, id)) ||
    !raw.hired.includes('helper')
  )
    return null;
  if (!Array.isArray(raw.duty) || new Set(raw.duty).size !== raw.duty.length) return null;
  const staffSlots = levelConfig(raw.level).staffSlots;
  if (Number.isSafeInteger(staffSlots) && raw.duty.length > staffSlots) return null;
  if (!raw.staffState || typeof raw.staffState !== 'object') return null;
  for (const id of raw.hired) {
    const status = raw.staffState[id];
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
        !levelConfig(raw.level).fatigueEnabled &&
        (status.rest !== 0 || status.worked !== 0))
    )
      return null;
  }
  if (!raw.duty.every((id) => raw.hired.includes(id) && staffAvailable(raw.staffState, id)))
    return null;
  if (sourceVersion < 4) {
    const partner = levelConfig(raw.level).partner;
    const hired = raw.hired.filter(
      (id) => sourceVersion !== 3 || raw.level <= 3 || id !== 'veteran',
    );
    if (partner && !hired.includes(partner)) hired.push(partner);
    const duty = partner ? [partner] : raw.duty.filter((id) => hired.includes(id));
    if (!duty.length && raw.duty.includes('veteran') && staffAvailable(raw.staffState, 'helper'))
      duty.push('helper');
    raw = {
      ...raw,
      hired,
      duty,
      staffState: {
        ...raw.staffState,
        ...(partner ? { [partner]: { worked: 0, rest: 0 } } : {}),
      },
    };
  }
  const frozenApplicants =
    raw.frozenApplicants == null
      ? null
      : Array.isArray(raw.frozenApplicants) &&
          new Set(raw.frozenApplicants).size === raw.frozenApplicants.length &&
          raw.frozenApplicants.every((id) => typeof id === 'string' && Object.hasOwn(STAFF, id))
        ? [...raw.frozenApplicants]
        : null;
  if (raw.frozenApplicants != null && frozenApplicants == null) return null;
  const training = validateTraining(raw.training, raw.hired);
  if (training === null) return null;
  const record: Checkpoint = {
    version: CHECKPOINT_VERSION,
    level: raw.level,
    cash: raw.cash,
    stock: raw.stock,
    duty: [...raw.duty],
    staffState: Object.fromEntries(raw.hired.map((id) => [id, { ...raw.staffState[id] }])),
    hired: [...raw.hired],
    equipment,
    training,
    layout,
    completed: raw.completed,
    frozenApplicants,
    rollback: null,
  };
  if (!includeRollback) return record;
  if (raw.rollback == null) return { ...record, rollback: null };
  if (typeof raw.rollback !== 'object' || Array.isArray(raw.rollback)) return null;
  const preparation = raw.rollback.preparation
    ? normalizeRollbackEntry(raw.rollback.preparation, true, sourceVersion)
    : null;
  const previous = raw.rollback.previous
    ? normalizeRollbackEntry(raw.rollback.previous, false, sourceVersion)
    : null;
  if ((raw.rollback.preparation && !preparation) || (raw.rollback.previous && !previous))
    return null;
  return { ...record, rollback: { preparation, previous } };
}

function readCheckpoint(): Checkpoint | null {
  try {
    const raw = globalThis.localStorage?.getItem(CHECKPOINT_KEY);
    return typeof raw === 'string' ? validateCheckpoint(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// Archive each paid opening once; replaying an earlier stage never replaces a later one.
function archiveEntry(record: Checkpoint): Checkpoint {
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

function readStages(
  checkpoint: Checkpoint | null,
  fallback: Record<string, Checkpoint> = {},
): Record<string, Checkpoint> {
  const stages: Record<string, Checkpoint> = { ...fallback };
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(STAGES_KEY) ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      for (const [level, value] of Object.entries(saved)) {
        const record = validateCheckpoint(value);
        if (record && String(record.level) === level) stages[level] = archiveEntry(record);
      }
  } catch {
    /* Keep valid legacy and in-memory saves if storage is unavailable. */
  }
  for (
    let record: Checkpoint | null | undefined = checkpoint;
    record;
    record = record.rollback?.previous?.snapshot
  ) {
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

function writeCheckpoint(
  value: Snapshot & { rollback?: CheckpointRollback | null; frozenApplicants?: string[] | null },
  completed = false,
): Checkpoint | null {
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

const freshState = (checkpoint: Checkpoint | null): StoreState => ({
  game:
    checkpoint && !checkpoint.completed
      ? createGame(checkpoint)
      : createGame({ cash: STARTING_CASH }),
  phase: 'ready',
  benchmark: false,
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
  reducedMotion: false,
  focusedStation: null,
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

export const useKitchen = create<StoreState>(() => freshState(initialCheckpoint));

const keys = new Set<string>();
let target: string | null = null,
  epoch = 0,
  policyChangedAt = -Infinity,
  retryAt = 0,
  lastPublish = 0;
const decisions = new Map<string, { controller: AbortController | null; lastDecision: number }>();
let audio: ReturnType<typeof createAudio> | undefined;
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
let shiftSnapshot: Checkpoint | null = null;
let frozenApplicants: string[] | null = null;
let applicantsRandom: (() => number) | null = null;

/** Ranked runs seed the applicant draw so the server replays the same hires. */
export function setApplicantsRandom(random: unknown) {
  applicantsRandom = typeof random === 'function' ? (random as () => number) : null;
}

function playSound(kind: string) {
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

function notify(text: string) {
  update({ toast: text, toastUntil: state().game.time + 2400 });
}

function snapshot(g: GameState): Snapshot {
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
    stock: level === 1 ? null : Number.isSafeInteger(g.stock) && (g.stock ?? 0) >= 0 ? g.stock : 0,
    duty: [...g.duty],
    staffState: Object.fromEntries(hired.map((id) => [id, { ...g.staffState[id] }])),
    hired,
    equipment: equipmentState(g.equipment),
    training: trainingState(g.training),
    layout: { ...g.layout },
  };
}

function record(who: string, result: ActionResult) {
  const g = state().game,
    cook = actor(g, who);
  if (!cook) return;
  cook.action = result.action ?? null;
  if (cook.lastActions)
    cook.lastActions = [
      ...cook.lastActions.slice(-5),
      { t: g.time, label: result.action ?? '', stock: g.stock, served: g.served },
    ];
  update({ log: [{ who, text: result.action ?? '' }, ...state().log].slice(0, 6) });
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
}: Partial<Snapshot> & {
  rollback?: CheckpointRollback | null;
  frozenApplicants?: string[] | null;
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
    tutorial: game.practice && !state().benchmark ? 0 : null,
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

export function benchmarkAction(candidate: Candidate): boolean {
  const { game, phase, benchmark } = state();
  if (!benchmark || phase !== 'playing' || !isFeasible(game, candidate, 'human')) return false;
  const selected = buildCandidates(game, 'human').find((c) => c.id === candidate.id);
  if (!selected) return false;
  if (selected.id === 'continue') return true;
  if (selected.id === 'dash') return dash(game);
  if (selected.dash) {
    if (!dash(game)) return false;
    if (selected.baseId) selected.id = selected.baseId;
  }
  if (selected.id === 'interact' || selected.partner) {
    game.human.intent = null;
    humanInteract();
    return true;
  }
  if (selected.id.startsWith('visit_')) {
    const near = stationAt(game, 'human');
    selected.automatic = !(near.inReach && near.id === selected.station);
  }
  game.human.intent = { ...selected, startedAt: game.time };
  return true;
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

export function setMenuOpen(open: boolean) {
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

export function setMenuPage(menuPage: string | null) {
  if (menuPage === null || MENU_PAGES.has(menuPage)) update({ menuPage });
}

export function setCameraMode(cameraMode: string) {
  if (['auto', 'follow', 'overview'].includes(cameraMode))
    update({ cameraMode: cameraMode as CameraMode });
}

export function restoreStage(level: number): boolean {
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

export function setMovementMode(movementMode: string) {
  if (movementMode === 'screen' || movementMode === 'grid')
    update({ movementMode: movementMode as MovementMode });
}

export function graphicsLost() {
  const phase = state().phase;
  invalidate();
  keys.clear();
  target = null;
  audio?.stop();
  update({ ready: false, phase: phase === 'playing' ? 'paused' : phase });
}

export function setMode(mode: string) {
  if (!MODES.has(mode)) return;
  invalidate();
  retryAt = 0;
  update({
    mode: mode as Mode,
    fallback: false,
    hud: { ...state().hud, action: '次の仕事を探しているよ。' },
  });
}

export function setPolicy(policy: unknown) {
  invalidate();
  policyChangedAt = state().game.time;
  update({ policy: typeof policy === 'string' ? policy.slice(0, 300) : '' });
}

export function nextShift(
  applicantId: string | null = null,
  buyStock?: number,
  assignedDuty?: string[],
  equipmentPurchases: string[] = [],
  layout?: unknown,
  vitamins: unknown[] = [],
): boolean {
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
  const rollback: CheckpointRollback = {
    // `snapshot` is the pre-validation opening; `writeCheckpoint` re-validates
    // the whole rollback chain before it is stored.
    preparation: { snapshot: snapshot(g) as Checkpoint, applicants },
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

export function setPreparationPreview(preview: { equipment?: unknown; layout?: unknown } | null) {
  const current = state();
  if (preview === null) {
    if (current.preparationPreview) update({ preparationPreview: null });
    return;
  }
  if (!current.ready || current.phase !== 'finished' || !current.cleared) return;
  const level = Math.min(MAX_LEVEL, current.game.level + 1);
  if (!preview || !validateEquipment(preview.equipment, level)) return;
  const equipment = equipmentState(preview.equipment);
  const layout = resolveLayout({ level, equipment }, preview.layout);
  if (!layout) return;
  update({ preparationPreview: { ...current.game, level, equipment, layout } });
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

function tutorialStep(): number | null {
  const step = state().tutorial;
  return step !== null && Number.isInteger(step) && step >= 0 && step < TUTORIAL_STEPS.length
    ? step
    : null;
}

export function goTo(id: string): void {
  const current = state();
  if (current.phase !== 'playing' || current.menuOpen || !STATIONS[id]) return;
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

export function humanInteract(automatic = false, stationOnly = false) {
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
    ['chopping', 'cooking'].includes(g.stations[near.id ?? ''].state ?? '')
  ) {
    target = null;
    return;
  }
  target = null;
  const result = interact(g, 'human', near.id ?? '');
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
    notify(result.reason ?? '');
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
  const typing = (e: KeyboardEvent) =>
    (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
  const down = (e: KeyboardEvent) => {
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
    if (state().phase !== 'playing') return;
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
  const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
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

function applyDecision(
  who: string,
  cand: Candidate | undefined,
  latency: number,
  via: string,
  confidence: number | null = null,
) {
  const { game: g, hud } = state();
  if (!cand) return;
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

async function decide(who: string) {
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
    const data = (await response.json()) as {
      ok?: boolean;
      result?: { answers?: { next_action?: { choice?: string; confidence?: number } } };
      via?: string;
    };
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

export function tick(delta: number) {
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
    benchmark: state().benchmark,
    stillPlaying: () => state().phase === 'playing',
    onTargetArrive: () => humanInteract(true),
    onHumanArrive: (intent) => humanInteract(intent.automatic ?? false, true),
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
