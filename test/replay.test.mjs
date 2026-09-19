import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCandidates, createGame } from '../src/model.js';
import { kitchenHasWork, playingCandidates } from '../src/benchmark.js';
import { useKitchen, startBenchmark, benchmarkAction, tick } from '../src/game.js';
import { runReplayShift, rankedScenario, REPLAY_STEP, MAX_REPLAY_STEPS } from '../src/replay.js';

// Replay must equal live play frame for frame, or a verified score means nothing.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} },
});

// A deterministic player policy for the Lv1 salad: tomato → chop → plate →
// assemble → serve, with waits while the board is busy.
function scriptedPolicy(g) {
  const has = (id) => buildCandidates(g, 'human').find((c) => (c.baseId ?? c.id) === id);
  const board = g.stations.board.state;
  const carrying = g.human.carrying;
  if (carrying === 'dish') return has('serve') ?? has('discard');
  if (carrying === 'tomato') return has('chop');
  if (carrying === 'plate')
    return board === 'chopped' ? (has('plate') ?? has('assemble') ?? has('interact')) : has('wait');
  if (carrying === 'chopped') return has('fetch_plate');
  if (board === 'chopped') return has('fetch_plate');
  if (board === 'chopping') return has('wait');
  if (g.stock !== 0 && has('fetch_tomato')) return has('fetch_tomato');
  return has('wait');
}

/**
 * Drive the real store-driven benchmark with one decision per ready frame, the
 * same cadence `runReplayShift` uses, and return the decisions it applied.
 */
function playLive(level = 1) {
  useKitchen.setState({ ready: true, phase: 'ready', menuOpen: false });
  startBenchmark();
  useKitchen.setState({ game: createGame(rankedScenario(level)) });
  const decisions = [];
  let navigating = false;
  for (let step = 0; step < MAX_REPLAY_STEPS; step++) {
    const state = useKitchen.getState();
    if (state.phase !== 'playing') break;
    const g = state.game;
    if (!g.human.intent && kitchenHasWork(g)) {
      const candidates = playingCandidates(g, navigating);
      const pick = scriptedPolicy(g);
      assert.ok(pick, 'the scripted policy must find an action');
      const selected = candidates.find((candidate) => candidate.id === pick.id);
      assert.ok(selected, `live policy id ${pick.id} must be a legal candidate`);
      decisions.push(selected.id);
      const applied =
        selected.id === 'navigate' || selected.id === 'back_to_work'
          ? selected.id === 'navigate'
          : benchmarkAction(selected);
      assert.ok(applied, `live action ${selected.id} must apply`);
      if (selected.id !== 'back_to_work') navigating = selected.id === 'navigate';
    }
    tick(REPLAY_STEP);
  }
  const final = useKitchen.getState().game;
  return {
    decisions,
    served: final.served,
    score: final.score,
    missed: final.missed,
    burned: final.burned,
    time: final.time,
  };
}

test('ranked replay is deterministic and matches live play frame for frame', () => {
  const live = playLive(1);
  assert.ok(live.decisions.length > 5, 'the scripted run must make real decisions');
  assert.ok(live.served > 0, 'the scripted run must serve at least one dish');
  const replayed = runReplayShift({ level: 1, decisions: live.decisions });
  assert.equal(replayed.served, live.served);
  assert.equal(replayed.score, live.score);
  assert.equal(replayed.missed, live.missed);
  assert.equal(replayed.burned, live.burned);
  assert.equal(replayed.timeMs, Math.round(live.time));
  assert.equal(replayed.decisionsUsed, live.decisions.length);

  const again = runReplayShift({ level: 1, decisions: live.decisions });
  assert.deepEqual(again, replayed);
});

test('the ranked scenario is fixed so no seed is needed', () => {
  const first = runReplayShift({ decisions: [] });
  const second = runReplayShift({ decisions: [] });
  assert.deepEqual(first, second);
  assert.equal(first.completed, false);
  assert.equal(rankedScenario(5).level, 5);
  assert.equal(runReplayShift({ level: 5, decisions: [] }).level, 5);
});

test('a truncated decision list cannot create a better result than the run it encodes', () => {
  const live = playLive(1);
  const full = runReplayShift({ level: 1, decisions: live.decisions });
  const cut = runReplayShift({ level: 1, decisions: live.decisions.slice(0, 4) });
  assert.ok(cut.served <= full.served);
  assert.ok(cut.decisionsUsed <= 4);
});
