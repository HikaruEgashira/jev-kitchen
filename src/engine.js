/**
 * Deterministic world step, shared by the live game and replay verification.
 *
 * `tickWorld` mutates the game object exactly like a frame of play: it advances
 * clocks, moves the human from keyboard/target input, and progresses every
 * actor's pending intent. It owns no store, network, audio or storage, so the
 * same call produces the same result in the browser and on the server.
 *
 * Callers own everything nondeterministic: player input, async decisions,
 * publishing and finishing. `host` supplies those.
 */
import {
  advance,
  movePlayer,
  moveToward,
  stationAt,
  actor,
  interact,
  discard,
  isFeasible,
  stationInfo,
  SPEED,
} from './model.js';
import { STAFF } from './staff.js';
import { trainingMultiplier } from './training.js';

// Keep 1 FPS timing honest; visibility and blur pause longer stalls.
const MAX_FRAME_DELTA = 1;

export function tickWorld(g, delta, host) {
  const dt = Math.min(MAX_FRAME_DELTA, Math.max(0, Number.isFinite(delta) ? delta : 0));
  const missedBefore = g.missed;
  advance(g, dt * 1000);
  const missed = g.missed > missedBefore;
  if ((g.practice && g.served >= g.quota) || (!g.practice && g.time >= g.duration))
    return { missed, finished: true };

  const humanStep = SPEED * trainingMultiplier(g.training, 'human', 'move');
  const step = humanStep * dt * (g.time < g.human.dashUntil ? 2.7 : 1);
  if (host.ax || host.ay) {
    movePlayer(g, host.ax, host.ay, step, host.movementMode);
  } else if (host.target) {
    const station = stationInfo(g, host.target);
    if (moveToward(g.human, station.x, station.y, step)) host.onTargetArrive();
  }
  if (host.stillPlaying && !host.stillPlaying()) return { missed, finished: true };

  for (const who of ['human', ...g.duty]) {
    const near = stationAt(g, who);
    actor(g, who).station = near.inReach ? near.id : null;
  }
  const activeActors = host.benchmark ? ['human', ...g.duty] : g.duty;
  for (const who of activeActors) {
    const cook = actor(g, who);
    if (!cook) continue;
    const intent = cook.intent;
    if (!intent) continue;
    if (intent.id === 'wait') {
      const waitMs = who === 'human' ? 250 : (STAFF[who]?.decisionMs ?? 1800);
      if (g.time - intent.startedAt > waitMs) cook.intent = null;
    } else if (who === 'human' && intent.dx !== undefined) {
      const remaining = Math.max(0, 250 - (g.time - dt * 1000 - intent.startedAt));
      movePlayer(
        g,
        intent.dx,
        intent.dy,
        humanStep * Math.min(dt, remaining / 1000) * (g.time < cook.dashUntil ? 2.7 : 1),
        'screen',
      );
      if (g.time - intent.startedAt >= 250) cook.intent = null;
    } else if (!isFeasible(g, intent, who)) {
      cook.intent = null;
    } else if (intent.id === 'discard') {
      discard(g, who);
      cook.intent = null;
    } else {
      const station = stationInfo(g, intent.station);
      const staff = STAFF[who] ?? STAFF.helper;
      if (
        who !== 'human' &&
        staff.canDash &&
        g.time >= cook.dashReadyAt &&
        g.time >= cook.dashUntil
      ) {
        cook.dashUntil = g.time + 220;
        cook.dashReadyAt = g.time + 1800;
      }
      const actorSpeed = who === 'human' ? 1 : 0.9 * staff.speed;
      const actorStep = SPEED * trainingMultiplier(g.training, who, 'move');
      const dashSpeed = g.time < cook.dashUntil ? 2.7 : 1;
      if (moveToward(cook, station.x, station.y, actorStep * dt * actorSpeed * dashSpeed)) {
        if (who === 'human' && intent.id.startsWith('visit_')) {
          host.onHumanArrive(intent);
        } else if (!intent.id.startsWith('move_') && isFeasible(g, intent, who)) {
          const result = interact(g, who, intent.station);
          if (result.ok) host.onRecord(who, result);
        }
        cook.intent = null;
      }
    }
  }
  return { missed, finished: false };
}
