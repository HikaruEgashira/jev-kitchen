/**
 * Deterministic campaign replay for verified ranking.
 *
 * The ranked artifact is the decision chain the server issued during a bench
 * run. Given the same `seed` and `decisions`, `runReplayCampaign` always
 * produces the same result on the client and on the server, so a submitted run
 * is re-simulated at submission time instead of trusted. The world step is
 * shared with live play (`src/engine.ts`) and the shift transition with
 * `game.ts` (`src/nextShift.ts`). Applicants come from a seeded draw so the
 * server sees the same hires the client saw.
 *
 * NOTE: importing `preparationCandidates` from `benchmark.js` keeps one source
 * of truth for preparation candidates. `benchmark.js` must not import this file.
 */
import {
  createGame,
  buildCandidates,
  isFeasible,
  rulePick,
  interact,
  stationAt,
  handoff,
  handoffOption,
  dash,
  kitchenHasWork,
  MAX_LEVEL,
} from './model.ts';
import { STAFF, nextStaffState } from './staff.ts';
import { tickWorld } from './engine.ts';
import { nextShiftParams } from './nextShift.ts';
import { drawApplicants, seededRandom } from './applicants.ts';
import { preparation, purchase, applyPreparationView, preparationKey } from './ui.ts';
import { preparationCandidates } from './benchmark.ts';
import type { GameState, PrepCandidate, ViewState } from './types.ts';

export const RANKED_PROTOCOL = 'jev-ranked-v2';
export const REPLAY_STEP = 1 / 60;
export const MAX_REPLAY_STEPS = 60 * 60 * 5;
const MAX_PREPARATION_VISITS = 3;

/** Mutating core of `humanInteract`, without tutorial, UI or store. */
function headlessInteract(g: GameState, automatic = false): boolean {
  const near = stationAt(g, 'human');
  const transfer = !automatic && handoffOption(g);
  if (transfer) return handoff(g, transfer.partner).ok;
  if (!near.inReach) return false;
  if (
    automatic &&
    !g.human.carrying &&
    ['chopping', 'cooking'].includes(g.stations[near.id ?? ''].state ?? '')
  )
    return false;
  return interact(g, 'human', near.id ?? '').ok;
}

/** Mirror of `benchmarkAction` for the human, including the navigation pages. */
function applyHumanChoice(g: GameState, id: string): boolean {
  // Page switches only change which candidates the model is shown; they have no
  // effect on the simulation, so replay treats them as no-ops.
  if (id === 'navigate' || id === 'back_to_work') return true;
  const selected = buildCandidates(g, 'human').find((candidate) => candidate.id === id);
  if (!selected || !isFeasible(g, selected, 'human')) return false;
  if (selected.id === 'continue') return true;
  if (selected.id === 'dash') return dash(g);
  if (selected.dash) {
    if (!dash(g)) return false;
    if (selected.baseId) selected.id = selected.baseId;
  }
  if (selected.id === 'interact' || selected.partner) {
    g.human.intent = null;
    headlessInteract(g, false);
    return true;
  }
  if (selected.id.startsWith('visit_')) {
    const near = stationAt(g, 'human');
    selected.automatic = !(near.inReach && near.id === selected.station);
  }
  g.human.intent = { ...selected, startedAt: g.time };
  return true;
}

/** Mirror of the `mode === 'rule'` branch of `game.js` `decide`. */
function partnerDecide(g: GameState, lastDecision: Record<string, number>) {
  for (const who of g.duty) {
    const cook = g.crew[who];
    if (!cook || cook.intent) continue;
    if (g.time - lastDecision[who] < STAFF[who].decisionMs) continue;
    lastDecision[who] = g.time;
    const candidates = buildCandidates(g, who);
    const pick = candidates.length === 1 ? candidates[0] : rulePick(g, candidates, who);
    if (pick && isFeasible(g, pick, who)) cook.intent = { ...pick, startedAt: g.time };
  }
}

/** Headless mirror of `prepare` in `benchmark.js`, without store access. */
function applyPreparation(
  candidate: PrepCandidate,
  plan: ViewState,
  g: GameState,
  applicants: string[],
): 'open' | 'prepared' {
  return applyPreparationView(candidate, plan, g, applicants);
}

function openShiftParams(g: GameState, plan: ViewState, applicants: string[]) {
  const bill = purchase(g, plan);
  if (bill.error) return null;
  return nextShiftParams(g, {
    applicants,
    applicantId: plan.selected,
    buyStock: bill.quantity,
    assignedDuty: bill.duty,
    equipmentPurchases: bill.equipmentPurchases,
    layout: bill.layout,
    vitamins: bill.vitamins,
  });
}

/** Play one shift to its end, consuming playing decisions in recorded order. */
function playShift(g: GameState, decisions: string[], cursor: { index: number }) {
  const lastDecision: Record<string, number> = Object.fromEntries(
    g.duty.map((id) => [id, -Infinity]),
  );
  let truncated = false;
  for (let step = 0; step < MAX_REPLAY_STEPS; step++) {
    if (!g.human.intent && kitchenHasWork(g)) {
      if (cursor.index >= decisions.length) {
        truncated = true;
        break;
      }
      applyHumanChoice(g, decisions[cursor.index++]);
    }
    const { finished } = tickWorld(g, REPLAY_STEP, {
      ax: 0,
      ay: 0,
      target: null,
      movementMode: 'grid',
      benchmark: true,
      onTargetArrive: () => {},
      onHumanArrive: (intent) => headlessInteract(g, Boolean(intent?.automatic)),
      onRecord: () => {},
    });
    if (finished) return { truncated: false };
    partnerDecide(g, lastDecision);
  }
  return { truncated };
}

/** Walk one level's preparation, consuming preparation decisions in order. */
function prepareNextShift(
  g: GameState,
  decisions: string[],
  cursor: { index: number },
  applicants: string[],
): { game: GameState | null; truncated?: boolean; diverged?: boolean; looped?: boolean } {
  const plan: ViewState = { ...preparation(g), stage: 'hiring' };
  const visits = new Map<string, number>();
  for (let guard = 0; guard < MAX_REPLAY_STEPS; guard++) {
    const candidates = preparationCandidates({ game: g, applicants }, plan);
    let candidate: PrepCandidate | undefined;
    if (candidates.length === 1) {
      candidate = candidates[0];
    } else {
      if (cursor.index >= decisions.length) return { game: null, truncated: true };
      const id = decisions[cursor.index++];
      candidate = candidates.find((entry) => entry.id === id);
      if (!candidate) return { game: null, diverged: true };
    }
    const outcome = applyPreparation(candidate, plan, g, applicants);
    if (outcome === 'open') {
      const params = openShiftParams(g, plan, applicants);
      if (params) return { game: createGame(params), truncated: false };
      // Failed confirmation: the model is asked again at the same stage.
      continue;
    }
    const signature = preparationKey(plan);
    const count = (visits.get(signature) ?? 0) + 1;
    visits.set(signature, count);
    if (count >= MAX_PREPARATION_VISITS) return { game: null, looped: true };
  }
  return { game: null, truncated: true };
}

/** One replay shift summary. */
export interface ReplayShift {
  level: number;
  cleared: boolean;
  served: number;
  quota: number;
  score: number;
  missed: number;
  burned: number;
}

export function runReplayCampaign({
  seed = 0,
  decisions = [],
}: { seed?: number; decisions?: string[] } = {}) {
  const random = seededRandom(seed);
  const cursor = { index: 0 };
  const shifts: ReplayShift[] = [];
  let g = createGame({ level: 1, cash: 180 });
  let completed = false;
  let truncated = false;
  let diverged = false;
  for (let guard = 0; guard < MAX_LEVEL + 2; guard++) {
    const { truncated: shiftTruncated } = playShift(g, decisions, cursor);
    const cleared = g.served >= g.quota;
    shifts.push({
      level: g.level,
      cleared,
      served: g.served,
      quota: g.quota,
      score: g.score,
      missed: g.missed,
      burned: g.burned,
    });
    if (!cleared) {
      truncated = shiftTruncated;
      break;
    }
    if (g.level >= MAX_LEVEL) {
      completed = true;
      break;
    }
    const applicants = g.level >= 3 ? drawApplicants(Object.keys(nextStaffState(g)), random) : [];
    const next = prepareNextShift(g, decisions, cursor, applicants);
    if (!next.game) {
      truncated = next.truncated ?? false;
      diverged = next.diverged ?? false;
      break;
    }
    g = next.game;
  }
  const clearedLevels = shifts.filter((shift) => shift.cleared).length;
  return {
    protocol: RANKED_PROTOCOL,
    completed,
    truncated,
    diverged,
    decisionsUsed: cursor.index,
    decisionsTotal: decisions.length,
    reachedLevel: g.level,
    clearedLevels,
    score: shifts.reduce((sum, shift) => sum + shift.score, 0),
    served: shifts.reduce((sum, shift) => sum + shift.served, 0),
    shifts,
  };
}
