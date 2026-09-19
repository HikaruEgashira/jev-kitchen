/**
 * Shared domain types.
 *
 * The game state is a plain mutable object built by `createGame`. These
 * interfaces name the shapes that `model.ts` and its callers pass around so the
 * whole codebase type-checks under `strict`, instead of relying on implicit any.
 */

export type RecipeId = 'dish' | 'soup' | 'roast';
export type ItemId = 'tomato' | 'chopped' | 'plate' | RecipeId;
export type Capability = 'prep' | 'cook' | 'serve';
export type StaffRole = 'allrounder' | 'runner' | 'chef' | 'expediter';
export type MovementMode = 'screen' | 'grid';
export type CameraMode = 'auto' | 'follow' | 'overview';
export type Mode = 'jev' | 'rule' | 'llm';
export type Phase = 'ready' | 'playing' | 'paused' | 'finished';
export type StationKind = 'crate' | 'board' | 'pot' | 'grill' | 'plates' | 'serve' | 'warmer';
export type StationStateName = 'idle' | 'chopping' | 'chopped' | 'cooking' | 'ready' | 'burnt';

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
  phase: string;
  stage?: string | null;
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

export interface BenchResult {
  protocol: string;
  revision: string;
  model: { id: string; name: string };
  startedAt: string;
  conditions: Record<string, unknown>;
  status: string;
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
  finalShift: Record<string, unknown>;
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
  [key: string]: unknown;
}

export interface ApplicantEntry {
  id: string;
  capabilities: string[];
  cost: number;
  wage: number;
  [key: string]: unknown;
}

export interface PreparationContext {
  stage?: string | null;
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
  [key: string]: unknown;
}

/** One model-facing decision context; the bench request's `state`. */
export interface DecisionContext {
  phase: string;
  preparation?: PreparationContext;
  controlled_actor?: string;
  level?: number;
  quota?: number;
  orders_served?: number;
  stock?: number | null;
  seconds_left?: number | null;
  human?: { recent_actions?: unknown; [key: string]: unknown };
  crew?: unknown;
  orders?: { recipe: RecipeId }[];
  recipes?: Record<string, string>;
  dash_ready_in_ms?: number;
  stations?: Record<string, unknown>;
  situation?: string;
  recent_actions?: { action: string; applied: boolean }[];
  loop_warning?: string;
  [key: string]: unknown;
}

export interface DecisionInput {
  phase: string;
  preparation?: {
    stage?: string | null;
    bill: { cash: number; stock: number; equipment: EquipmentState; training: TrainingState };
    cash?: number;
    next_level: LevelConfig;
    duty?: string[];
    quantity?: number | string;
    recommended_purchase?: number;
    previous_sales?: number;
    roster?: RosterEntry[];
    applicants?: ApplicantEntry[];
    equipmentPurchases?: string[];
    recent_actions?: string[];
    [key: string]: unknown;
  };
  cash?: number;
  controlled_actor?: string;
  level?: number;
  quota?: number;
  orders_served?: number;
  stock?: number | null;
  seconds_left?: number | null;
  human?: unknown;
  crew?: unknown;
  orders?: { recipe: RecipeId }[];
  dash_ready_in_ms?: number;
  stations?: Record<
    string,
    {
      active: boolean;
      x?: number;
      y?: number;
      state?: string;
      by?: string | null;
      burn_seconds?: number | null;
      [key: string]: unknown;
    }
  >;
  cooking?: Record<string, { remaining_ms: number; progress: number | null; boosted: boolean }>;
  [key: string]: unknown;
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

export type EquipmentState = Record<string, EquipmentCount>;

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
  equipment?: EquipmentState;
  layout?: Layout;
  training?: TrainingState;
}

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
  layoutMode?: string;
  layoutSelection?: string | null;
  layoutIndex?: number;
  stagePage?: number;
  advicePage?: number;
  resetArmed?: boolean;
  error?: string;
  history?: { key: string; label: string }[];
  looping?: boolean;
  stage?: string | null;
  recentActions?: string[];
}

/** Render hints a screen item may carry. Unknown keys stay renderer-owned. */
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
  [key: string]: unknown;
}

export interface ScreenItem extends ScreenExtra {
  kind?: string;
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
