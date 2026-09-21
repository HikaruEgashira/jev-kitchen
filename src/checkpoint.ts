/**
 * Pure checkpoint validation and campaign submission shape.
 *
 * The live game and the Worker share these functions: the client validates a
 * save before trusting it, and the ranking route re-validates the stage
 * snapshots a client submits. Keeping one implementation here is what stops the
 * two sides from drifting apart. Nothing in this module touches the DOM, the
 * store or storage.
 */
import { MAX_LEVEL, quotaForLevel, resolveLayout } from './model.ts';
import { STAFF, staffAvailable } from './staff.ts';
import { levelConfig } from './progression.ts';
import { equipmentState, validateEquipment } from './equipment.ts';
import { trainingState, validateTraining } from './training.ts';
import type { Checkpoint, GameState, RollbackLink, Snapshot, StaffState } from './types.ts';

export const CHECKPOINT_VERSION = 5;
export const STARTING_CASH = 180;
/** Protocol tag for a campaign submitted from the normal game page. */
export const HUMAN_PROTOCOL = 'jev-human-v1';

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

function safeMoney(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeStock(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

export function normalizeRollbackEntry(
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

export function validateCheckpoint(
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

/** The persisted opening state without the checkpoint envelope. */
export function snapshot(g: GameState): Snapshot {
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

/** Drop the envelope from a checkpoint so it can be submitted as a snapshot. */
export function checkpointSnapshot(record: Checkpoint): Snapshot {
  return {
    level: record.level,
    cash: record.cash,
    stock: record.stock,
    duty: [...record.duty],
    staffState: Object.fromEntries(
      Object.entries(record.staffState).map(([id, status]) => [id, { ...status }]),
    ),
    hired: [...record.hired],
    equipment: record.equipment,
    training: record.training,
    layout: { ...record.layout },
  };
}

/**
 * The contiguous stage openings from Lv1 up to the first gap, in order. The
 * submission is the chain itself, so a gap would make the claimed progress
 * unverifiable; truncating keeps a legitimate but partial save submittable.
 */
export function campaignSnapshots(stages: Record<string, Checkpoint>): Snapshot[] {
  const out: Snapshot[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const record = stages[String(level)];
    if (!record || record.level !== level) break;
    out.push(checkpointSnapshot(record));
  }
  return out;
}

export interface CampaignSubmission {
  protocol: string;
  owner: string;
  completed: boolean;
  score: number;
  snapshots: Snapshot[];
}

export interface VerifiedCampaign {
  owner: string;
  reachedLevel: number;
  clearedLevels: number;
  completed: boolean;
  score: number;
}

/**
 * Re-validate a submitted campaign on the server. This checks structural
 * validity of every stage opening, not that the run was actually played: it is
 * a plausibility gate, not proof. Returns null for anything malformed.
 */
export function validateCampaignSubmission(body: unknown): VerifiedCampaign | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const submission = body as Partial<CampaignSubmission>;
  if (submission.protocol !== HUMAN_PROTOCOL) return null;
  if (typeof submission.owner !== 'string') return null;
  const owner = submission.owner.trim();
  if (owner.length === 0 || owner.length > 64) return null;
  if (typeof submission.completed !== 'boolean') return null;
  if (!Array.isArray(submission.snapshots)) return null;
  const snapshots = submission.snapshots;
  if (snapshots.length < 1 || snapshots.length > MAX_LEVEL) return null;
  for (let index = 0; index < snapshots.length; index++) {
    const level = index + 1;
    const record = validateCheckpoint(
      {
        ...(snapshots[index] as object),
        version: CHECKPOINT_VERSION,
        completed: false,
        frozenApplicants: null,
        rollback: null,
      },
      false,
    );
    if (!record || record.level !== level) return null;
  }
  const reachedLevel = snapshots.length;
  const exhausted = submission.completed === true && reachedLevel >= MAX_LEVEL;
  return {
    owner,
    reachedLevel,
    clearedLevels: exhausted ? reachedLevel : reachedLevel - 1,
    completed: exhausted,
    score:
      Number.isSafeInteger(submission.score) && (submission.score as number) >= 0
        ? (submission.score as number)
        : 0,
  };
}
