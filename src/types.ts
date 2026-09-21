/**
 * Shared domain types.
 *
 * The game state is a plain mutable object built by `createGame`. These
 * interfaces name the shapes that `model.ts` and its callers pass around so the
 * whole codebase type-checks under `strict`, instead of relying on implicit any.
 */
import type { observe } from './model.ts';

export type RecipeId = 'dish' | 'soup' | 'roast';
export type ItemId = 'tomato' | 'chopped' | 'plate' | RecipeId;
export type Capability = 'prep' | 'cook' | 'serve';
export type StaffRole = 'allrounder' | 'runner' | 'chef' | 'expediter';
export type MovementMode = 'screen' | 'grid';
export type CameraMode = 'auto' | 'follow' | 'overview';
export type Mode = 'jev' | 'rule' | 'llm';
export type Phase = 'ready' | 'playing' | 'paused' | 'finished';
/** Human campaigns and bench runs are ranked on separate boards. */
export type LeaderboardKind = 'human' | 'ai';
export interface BoardEntry {
  sid: string;
  /** Dedupe key. Human runs use a client id so one player keeps one best slot. */
  owner: string;
  kind: LeaderboardKind;
  protocol: string;
  score: number;
  served: number;
  clearedLevels: number;
  reachedLevel: number;
  completed: boolean;
  truncated: boolean;
  at: number;
}
export type StationKind = 'crate' | 'board' | 'pot' | 'grill' | 'plates' | 'serve' | 'warmer';
export type StationStateName = 'idle' | 'chopping' | 'chopped' | 'cooking' | 'ready' | 'burnt';
export type EquipmentKind = 'board' | 'pot' | 'grill' | 'warmer' | 'kitchen';
export type BenchPhase = 'preparation' | 'playing';
export type BenchStatus = 'running' | 'completed' | 'failed' | 'budget' | 'error' | 'stopped';
export type PrepareStage = 'hiring' | 'staffing' | 'stock' | 'investment';
export type ScreenKind =
  | 'text'
  | 'panel'
  | 'button'
  | 'food'
  | 'avatar'
  | 'bar'
  | 'veil'
  | 'title3d'
  | 'number';
export type LayoutMode = 'equipment' | 'layout';

/** Shape of `observe()`; the model-facing subset of the game state. */
export type Observation = ReturnType<typeof observe>;

/** A station table entry (position and the offset its label sits at). */
export interface StationSlot {
  name: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface KitchenBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Station runtime. `{}` stations (crate, plates, serve) only use `state`. */
export interface StationState {
  state?: StationStateName;
  busyUntil?: number;
  by?: string | null;
  startedAt?: number;
  duration?: number;
  burnAt?: number;
  boosted?: boolean;
  quality?: boolean;
}

export interface Recipe {
  name: string;
  points: number;
  price: number;
  steps: string;
}

export interface Order {
  id: number;
  recipe: RecipeId;
  deadline: number;
  duration: number;
}

/** A selectable action. Preparation candidates add their own optional fields. */
export interface Candidate {
  id: string;
  baseId?: string;
  label: string;
  station?: string | null;
  partner?: string;
  item?: string;
  dx?: number;
  dy?: number;
  dash?: boolean;
  automatic?: boolean;
}

/** A preparation choice; mirrors editable `ViewState` fields. */
export interface PrepCandidate extends Candidate {
  selected?: string | null;
  duty?: string[];
  quantity?: number;
  equipmentPurchases?: string[];
  vitamins?: VitaminPurchase[];
}

export interface BenchLogEntry {
  call: number;
  action: string;
}

export interface BenchDecision {
  level: number;
  phase: BenchPhase;
  stage?: PrepareStage | null;
  stock?: number | null;
  served?: number;
  atMs?: number;
  action: string;
  label: string;
  applied: boolean;
  latencyMs?: number;
  via?: string;
  confidence?: number | null;
  candidateCount?: number;
  requestBytes?: number;
}

export interface BenchShiftRecord {
  level: number;
  cleared: boolean;
  served: number;
  playerServed: number;
  partnerServed: number;
  quota: number;
  score: number;
  missed: number;
  burned: number;
  staffId: string | null;
  duty: string[];
  hired: string[];
  stock: number | null;
  lastServeSeconds: number | null;
  equipment: EquipmentState;
  training: TrainingState;
  cash: number;
  applicants: string[];
}

export interface BenchConditions {
  frequency: number;
  maxRequests: number;
  partner: string;
  initialStaff: string | null;
  scriptedPartners: Record<string, string>;
  tutorialQuota: number;
  tutorialSeconds: number | null;
  shiftSeconds: number;
  playerDash: boolean;
  hiring: boolean;
}

export interface BenchFinalShift {
  level: number;
  elapsedMs: number;
  served: number;
  playerServed: number;
  partnerServed: number;
  quota: number;
  score: number;
}

export interface BenchResult {
  protocol: string;
  revision: string;
  model: { id: string; name: string };
  startedAt: string;
  conditions: BenchConditions;
  status: BenchStatus;
  error?: string;
  levels: BenchShiftRecord[];
  requests: number;
  staleResponses: number;
  errors: number;
  decisions: BenchDecision[];
  reachedLevel: number;
  clearedLevels: number;
  wallMs: number;
  activeMs: number;
  meanMs?: number | null;
  p95Ms?: number | null;
  finalShift: BenchFinalShift;
}

export interface BenchVerified {
  clearedLevels: number;
  score: number;
  reachedLevel: number;
}

export interface BenchState {
  running: boolean;
  paused: boolean;
  splits: BenchShiftRecord[];
  action: string;
  log: BenchLogEntry[];
  elapsedMs: number;
  requests: number;
  results: BenchResult[];
  verified: BenchVerified | null;
}

export interface RosterEntry {
  id: string;
  capabilities: string[];
  wage: number;
  worked: number;
  rest: number;
}

export interface ApplicantEntry {
  id: string;
  capabilities: string[];
  cost: number;
  wage: number;
}

export interface PreparationContext {
  stage?: PrepareStage | null;
  cash_before_purchase?: number;
  cash_remaining?: number;
  quantity?: number | string;
  next_level?: {
    level: number;
    quota: number;
    staffSlots: number;
    recipeMix: { dish: number; soup: number; roast: number };
  };
  duty?: string[];
  stock?: number;
  recommended_purchase?: number;
  previous_sales?: number;
  stock_price?: number;
  menu_prices?: Record<string, number>;
  roster?: RosterEntry[];
  applicants?: ApplicantEntry[];
  equipment?: EquipmentState;
  equipment_capacity?: { used: number; limit: number };
  training?: TrainingState;
  pending_equipment?: string[];
  recent_actions?: string[];
}

/** One station in the compacted playing context. */
export interface CompactStation {
  x?: number;
  y?: number;
  state?: string;
  by?: string | null;
  burn_seconds?: number | null;
  remaining_ms?: number;
  progress?: number | null;
  boosted?: boolean;
}

/** One model-facing decision context; the bench request's `state`. */
export interface DecisionContext {
  phase: BenchPhase;
  preparation?: PreparationContext;
  controlled_actor?: string;
  level?: number;
  quota?: number;
  orders_served?: number;
  stock?: number | null;
  seconds_left?: number | null;
  human?: Observation['human'];
  crew?: Observation['crew'];
  orders?: Observation['orders'];
  recipes?: Record<string, string>;
  dash_ready_in_ms?: number;
  stations?: Record<string, CompactStation>;
  situation?: string;
  recent_actions?: { action: string; applied: boolean }[];
  loop_warning?: string;
}

/** Preparation fields a caller passes into `benchRequest`. */
export interface PreparationInput {
  stage?: PrepareStage | null;
  bill: { cash: number; stock: number; equipment: EquipmentState; training: TrainingState };
  selected?: string | null;
  cash?: number;
  next_level: LevelConfig;
  duty?: string[];
  quantity?: number | string;
  recommended_purchase?: number;
  previous_sales?: number;
  unfilled_slots?: number;
  roster?: RosterEntry[];
  applicants?: ApplicantEntry[];
  equipmentPurchases?: string[];
  recent_actions?: string[];
}

/** The raw state fed to `compactDecisionState`. */
export interface DecisionInput {
  phase: BenchPhase;
  preparation?: PreparationInput;
  cash?: number;
  controlled_actor?: string;
  level?: number;
  quota?: number;
  orders_served?: number;
  stock?: number | null;
  seconds_left?: number | null;
  human?: Observation['human'];
  crew?: Observation['crew'];
  orders?: Observation['orders'];
  player_intent?: string | null;
  dash_ready_in_ms?: number;
  stations?: Observation['stations'];
  cooking?: Record<string, { remaining_ms: number; progress: number | null; boosted: boolean }>;
  situation?: string;
  recent_actions?: { action: string; applied: boolean }[];
  loop_warning?: string;
}

export interface Intent extends Candidate {
  startedAt: number;
}

export interface HandoffOption {
  partner: string;
  item: ItemId;
  label: string;
}

/** A recorded decision, used to detect repeated loops. */
export interface DecisionRecord {
  label?: string;
  action?: string;
  stock?: number | null;
  served?: number;
  applied?: boolean;
}

export interface ActionLogEntry {
  t: number;
  label: string;
  stock: number | null;
  served: number;
}

export interface Actor {
  served: number;
  x: number;
  y: number;
  carrying: ItemId | null;
  station: string | null;
  action: string | null;
  quality: boolean | null;
  lastActions: ActionLogEntry[];
  intent: Intent | null;
  dashUntil: number;
  dashReadyAt: number;
}

export interface ActionResult {
  ok: boolean;
  action?: string;
  reason?: string;
  points?: number;
  quality?: boolean;
}

export interface StaffState {
  worked: number;
  rest: number;
}

export interface TrainingEntry {
  move: number;
  cook: number;
}

export type TrainingState = Record<string, TrainingEntry>;

export interface EquipmentCount {
  count: number;
  level: number;
}

export type EquipmentState = Record<EquipmentKind, EquipmentCount>;

export interface EquipmentItem {
  name: string;
  initialCount: number;
  maxCount: number;
  unlockLevel: number;
  addUnlockLevel: number;
  upgradeUnlockLevel: number;
  addCost: number;
  upgradeCosts: readonly number[];
}

export interface Vitamin {
  name: string;
  icon: string;
  ability: string;
  effect: string;
  cost: number;
}

export interface StaffProfile {
  name: string;
  icon: string;
  color: string;
  role: StaffRole;
  description: string;
  capabilities: Capability[];
  canDash: boolean;
  employment: string;
  wage: number;
  maxConsecutive: number;
  restShifts: number;
  cost: number;
  decisionMs: number;
  speed: number;
  chop: number;
  cook: number;
}

export interface LevelConfig {
  level: number;
  kitchenTier: number;
  stockFinite: boolean;
  quota: number;
  orderWindowMs: number;
  recipeMix: Readonly<{ dish: number; soup: number; roast: number }>;
  partner: string | null;
  staffSlots: number;
  boostEnabled: boolean;
  burningEnabled: boolean;
  fatigueEnabled: boolean;
  rushEnabled: boolean;
  difficulty: number;
  unlockLabel: string;
}

export type Layout = Record<string, string>;

/** The mutable kitchen state. Live play and replay both hold one. */
export interface GameState {
  practice: boolean;
  level: number;
  duration: number;
  staffId: string;
  quota: number;
  cash: number;
  hired: string[];
  duty: string[];
  staffState: Record<string, StaffState>;
  stock: number | null;
  equipment: EquipmentState;
  training: TrainingState;
  time: number;
  served: number;
  score: number;
  burned: number;
  rushSpawned: boolean;
  combo: number;
  bestCombo: number;
  missed: number;
  lastServeAt: number;
  nextOrder: number;
  orders: Order[];
  stations: Record<string, StationState>;
  human: Actor;
  crew: Record<string, Actor>;
  layout: Layout;
  ai: Actor | null;
}

export interface GameConfig {
  practice?: boolean;
  level?: number;
  cash?: number;
  staffId?: string;
  hired?: string[];
  duty?: string[];
  staffState?: Record<string, Partial<StaffState>>;
  stock?: number | null;
  /** Raw input; normalized by `equipmentState`. */
  equipment?: unknown;
  layout?: Layout;
  training?: TrainingState;
}

/**
 * A partial game view accepted by the pure helpers. `equipment` stays raw
 * because callers may pass an unvalidated save or a partial override.
 */
export type GameLike = Partial<Omit<GameState, 'equipment'>> & { equipment?: unknown };

export interface Framing {
  target: [number, number, number];
  zoom: number;
}

/** The persisted opening state before validation adds the envelope fields. */
export interface Snapshot {
  level: number;
  cash: number;
  stock: number | null;
  duty: string[];
  staffState: Record<string, StaffState>;
  hired: string[];
  equipment: EquipmentState;
  training: TrainingState;
  layout: Layout;
}

export interface RollbackLink {
  snapshot: Checkpoint;
  applicants: string[];
}

export interface CheckpointRollback {
  preparation: RollbackLink | null;
  previous: RollbackLink | null;
}

/** A validated checkpoint record persisted to localStorage. */
export interface Checkpoint extends Snapshot {
  version: number;
  completed: boolean;
  frozenApplicants: string[] | null;
  rollback: CheckpointRollback | null;
}

export interface VitaminPurchase {
  item: string;
  target: string;
}

/** Editable preparation/hint form state, shared by the UI and benchmark. */
export interface ViewState {
  page?: number;
  applicantIndex?: number;
  selected?: string | null;
  duty?: string[];
  quantity?: number | string;
  equipmentPurchases?: string[];
  equipmentIndex?: number;
  vitamins?: VitaminPurchase[];
  vitaminItem?: string | null;
  layout?: Layout;
  layoutMode?: LayoutMode;
  layoutSelection?: string | null;
  layoutIndex?: number;
  stagePage?: number;
  advicePage?: number;
  resetArmed?: boolean;
  error?: string;
  history?: { key: string; label: string }[];
  looping?: boolean;
  stage?: PrepareStage | null;
  recentActions?: string[];
}

/** Render hints a screen item may carry. */
export interface ScreenExtra {
  size?: number;
  color?: string;
  ink?: string;
  edge?: string;
  action?: string;
  disabled?: boolean;
  pressed?: boolean;
  value?: string | number | null;
  href?: string;
  label?: string;
  ratio?: number;
  icon?: string | null;
  recipe?: string;
  avatar?: string;
  progress?: number | null;
  progressColor?: string;
  live?: boolean;
  h?: number;
  layout?: Layout;
  automatic?: boolean;
  slots?: number;
  max?: number;
}

export interface ScreenItem extends ScreenExtra {
  kind: ScreenKind;
  id: string;
  text?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  order?: number;
  inert?: boolean;
}

export interface BenchFeedback {
  loop?: boolean;
  recent?: string[];
}

export interface HudState {
  action: string;
  latency: number | null;
  via: string;
  confidence: number | null;
  dropped: number;
  decisions: number;
}

export interface LogEntry {
  who: string;
  text: string;
}

/** Zustand store shape for the live kitchen. */
export interface StoreState {
  game: GameState;
  phase: Phase;
  benchmark: boolean;
  benchPreparation: ViewState | null;
  benchFeedback: BenchFeedback | null;
  preparationPreview: GameState | null;
  revision: number;
  mode: Mode;
  policy: string;
  backend: string;
  ready: boolean;
  menuOpen: boolean;
  menuPage: string | null;
  cameraMode: CameraMode;
  movementMode: MovementMode;
  sound: boolean;
  backgroundMode: boolean;
  reducedMotion: boolean;
  focusedStation: string | null;
  autoMode: boolean;
  autoStatus: string;
  best: number;
  leaderboard: BoardEntry[];
  leaderboardKind: LeaderboardKind;
  checkpoint: Checkpoint | null;
  stages: Record<string, Checkpoint>;
  rollback: CheckpointRollback | null;
  reviewing: boolean;
  cleared: boolean;
  applicants: string[];
  campaignComplete: boolean;
  tutorial: number | null;
  toast: string;
  toastUntil: number;
  celebration: number;
  lastPoints: number;
  movingTo: string | null;
  hud: HudState;
  log: LogEntry[];
  fallback: boolean;
}
