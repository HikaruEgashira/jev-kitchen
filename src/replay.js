/**
 * Deterministic single-shift replay.
 *
 * The ranked artifact is a shift scored from an ordered list of decision ids.
 * Given the same `level` and `decisions`, `runReplayShift` always produces the
 * same result on the client and on the server, so a submitted run can be
 * re-simulated and trusted. The world step is shared with live play
 * (`src/engine.js`), so replay and the game cannot drift.
 *
 * The partner acts through the fixed rule policy (`rulePick`), exactly like the
 * benchmark's `rule` mode, so only the player's decisions are model input.
 * Deliberate scope: one shift, no between-shift preparation. The ranked
 * scenario carries no randomness, so no seed is needed.
 *
 * ponytail: extend to multi-shift campaigns by logging the preparation actions
 * (`hire_*`/`crew_*`/`stock_*`/`equipment_*`/`vitamin_*`/`open_shift`) and
 * replaying them through `nextShift`.
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
  activeStationIds,
  levelConfig,
  quotaForLevel,
} from './model.js';
import { STAFF } from './staff.js';
import { tickWorld } from './engine.js';

export const RANKED_PROTOCOL = 'jev-ranked-v1';
export const REPLAY_STEP = 1 / 60;
export const RANKED_LEVEL = 5;
export const MAX_REPLAY_STEPS = 60 * 60 * 5;

/** Fixed starting conditions for the ranked shift. No randomness. */
export function rankedScenario(level = RANKED_LEVEL) {
  const config = levelConfig(level);
  const normalized = config.level;
  const duty = config.partner ? [config.partner] : ['helper'];
  return {
    level: normalized,
    cash: 0,
    duty,
    hired: [...new Set(['helper', ...duty])],
    stock: quotaForLevel(normalized) + 6,
  };
}

export function hasWork(g) {
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

/** Mutating core of `humanInteract`, without tutorial, UI or store. */
function headlessInteract(g, automatic = false) {
  const near = stationAt(g, 'human');
  const transfer = !automatic && handoffOption(g);
  if (transfer) return handoff(g, transfer.partner).ok;
  if (!near.inReach) return false;
  if (automatic && !g.human.carrying && ['chopping', 'cooking'].includes(g.stations[near.id].state))
    return false;
  return interact(g, 'human', near.id).ok;
}

/**
 * Mirror of `benchmarkAction` for the human, including the navigation pages.
 * Returns false when the id is not a legal action in this state.
 */
function applyHumanChoice(g, id) {
  // Page switches only change which candidates the model is shown; they have no
  // effect on the simulation, so replay treats them as no-ops.
  if (id === 'navigate' || id === 'back_to_work') return true;
  const selected = buildCandidates(g, 'human').find((candidate) => candidate.id === id);
  if (!selected || !isFeasible(g, selected, 'human')) return false;
  if (selected.id === 'continue') return true;
  if (selected.id === 'dash') return dash(g);
  if (selected.dash) {
    if (!dash(g)) return false;
    selected.id = selected.baseId;
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
function partnerDecide(g, lastDecision) {
  for (const who of g.duty) {
    const cook = g.crew[who];
    if (!cook || cook.intent) continue;
    if (g.time - lastDecision[who] < STAFF[who].decisionMs) continue;
    lastDecision[who] = g.time;
    const candidates = buildCandidates(g, who);
    const pick = candidates.length === 1 ? candidates[0] : rulePick(g, candidates, who);
    if (isFeasible(g, pick, who)) cook.intent = { ...pick, startedAt: g.time };
  }
}

/**
 * @param {{ level?: number, decisions?: string[] }} [options]
 * @returns {{ level: number, protocol: string, completed: boolean, decisionsUsed: number, served: number, quota: number, score: number, missed: number, burned: number, timeMs: number }}
 */
export function runReplayShift({ level = RANKED_LEVEL, decisions = [] } = {}) {
  const g = createGame(rankedScenario(level));
  const lastDecision = Object.fromEntries(g.duty.map((id) => [id, -Infinity]));
  let index = 0;
  let completed = false;
  for (let step = 0; step < MAX_REPLAY_STEPS; step++) {
    if (!g.human.intent && hasWork(g)) {
      if (index >= decisions.length) break;
      applyHumanChoice(g, decisions[index++]);
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
    partnerDecide(g, lastDecision);
    if (finished) {
      completed = !g.practice && g.served >= g.quota;
      break;
    }
  }
  return {
    level: g.level,
    protocol: RANKED_PROTOCOL,
    completed,
    decisionsUsed: index,
    served: g.served,
    quota: g.quota,
    score: g.score,
    missed: g.missed,
    burned: g.burned,
    timeMs: Math.round(g.time),
  };
}
