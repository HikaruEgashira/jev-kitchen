// Pure kitchen model, shared by the browser game (public/game.js) and the
// node self-check (test/model.test.mjs). No DOM, no network.
//
// Division of labour: this file owns mechanics (preconditions, timing,
// feasibility). Jev owns the collaboration choice. The two only meet at
// buildCandidates() -> Choice criteria, and isFeasible() -> stale-decision gate.

export const REACH = 82; // px: how close you must stand to use a station
export const SPEED = 240; // px/s
export const CHOP_MS = 1400; // how long one tomato takes to chop

export const STATIONS = {
  crate: { id: 'crate', name: 'トマト箱', x: 140, y: 130 },
  board: { id: 'board', name: 'まな板', x: 400, y: 130 },
  plates: { id: 'plates', name: '皿の山', x: 660, y: 130 },
  serve: { id: 'serve', name: '配膳口', x: 400, y: 400 },
};
export const STATION_IDS = Object.keys(STATIONS);

export const ITEM_EMOJI = { tomato: '🍅', chopped: '🥗', plate: '🍽️', dish: '🍲' };

export function createGame() {
  return {
    time: 0,
    served: 0,
    stations: {
      crate: { holds: null },
      board: { state: 'idle', busyUntil: 0, by: null }, // idle | chopping | chopped
      plates: { holds: null },
      serve: { holds: null },
    },
    human: { x: 300, y: 320, carrying: null, station: null, action: null, lastActions: [] },
    ai: { x: 560, y: 320, carrying: null, station: null, action: null, intent: null },
  };
}

export function stationAt(g, who) {
  const e = g[who];
  let id = null;
  let dist = Infinity;
  for (const key of STATION_IDS) {
    const s = STATIONS[key];
    const d = Math.hypot(e.x - s.x, e.y - s.y);
    if (d < dist) {
      dist = d;
      id = key;
    }
  }
  return { id, dist, inReach: dist <= REACH };
}

export function moveToward(e, x, y, step) {
  const dx = x - e.x;
  const dy = y - e.y;
  const d = Math.hypot(dx, dy);
  if (d <= step) {
    e.x = x;
    e.y = y;
    return true;
  }
  e.x += (dx / d) * step;
  e.y += (dy / d) * step;
  return false;
}

/** The four stations' whole vocabulary. Used by both cooks and by isFeasible(). */
export function interact(g, who, stationId) {
  const e = g[who];
  const st = g.stations[stationId];
  if (!st) return { ok: false, reason: 'unknown station' };

  switch (stationId) {
    case 'crate':
      if (e.carrying) return { ok: false, reason: 'hands full' };
      e.carrying = 'tomato';
      return { ok: true, action: 'トマトを取った' };

    case 'plates':
      if (e.carrying) return { ok: false, reason: 'hands full' };
      e.carrying = 'plate';
      return { ok: true, action: '皿を取った' };

    case 'board':
      if (st.state === 'chopping') return { ok: false, reason: 'chopping' };
      if (st.state === 'idle' && e.carrying === 'tomato') {
        e.carrying = null;
        st.state = 'chopping';
        st.busyUntil = g.time + CHOP_MS;
        st.by = who;
        return { ok: true, action: '切り始めた' };
      }
      if (st.state === 'chopped' && e.carrying === 'plate') {
        st.state = 'idle';
        st.by = null;
        e.carrying = 'dish';
        return { ok: true, action: '盛り付けた' };
      }
      if (st.state === 'chopped' && !e.carrying) {
        st.state = 'idle';
        st.by = null;
        e.carrying = 'chopped';
        return { ok: true, action: '切ったトマトを持ち上げた' };
      }
      return { ok: false, reason: 'nothing to do' };

    case 'serve':
      if (e.carrying !== 'dish') return { ok: false, reason: 'nothing to serve' };
      e.carrying = null;
      g.served += 1;
      return { ok: true, action: '配膳した' };
  }
  return { ok: false, reason: 'unknown station' };
}

export function advance(g) {
  const b = g.stations.board;
  if (b.state === 'chopping' && g.time >= b.busyUntil) b.state = 'chopped';
}

/**
 * Mechanically feasible actions only. Collaboration (who should do what) is
 * deliberately NOT decided here — that is Jev's job, guided by `policy`.
 */
export function buildCandidates(g, who = 'ai') {
  const e = g[who];
  const b = g.stations.board;
  const out = [];
  const add = (id, label, station) => {
    if (!out.some((c) => c.id === id)) out.push({ id, label, station });
  };

  if (e.carrying === 'dish') add('serve', '完成した料理を配膳口へ運ぶ', 'serve');
  if (e.carrying === 'plate' && b.state === 'chopped') {
    add('plate', '切ったトマトを皿に盛り付ける', 'board');
  }
  if (e.carrying === 'tomato' && b.state === 'idle') {
    add('chop', 'トマトをまな板で切り始める', 'board');
  }
  if (!e.carrying) {
    if (b.state === 'idle') add('fetch_tomato', 'トマト箱からトマトを取る', 'crate');
    if (b.state === 'chopped') add('fetch_plate', '皿の山から皿を取る', 'plates');
    if (b.state === 'chopping') add('fetch_plate', '切れる間に皿を用意する', 'plates');
  }
  add('wait', '今は動かず、様子を見る', null);
  return out;
}

/** Re-checked immediately before execution, so a stale Jev answer is dropped, not acted on. */
export function isFeasible(g, cand) {
  const e = g.ai;
  const b = g.stations.board;
  switch (cand?.id) {
    case 'serve':
      return e.carrying === 'dish';
    case 'plate':
      return e.carrying === 'plate' && b.state === 'chopped';
    case 'chop':
      return e.carrying === 'tomato' && b.state === 'idle';
    case 'fetch_tomato':
      return !e.carrying && b.state === 'idle';
    case 'fetch_plate':
      return !e.carrying && (b.state === 'chopped' || b.state === 'chopping');
    case 'wait':
      return true;
    default:
      return false;
  }
}

const ACTION_INSTRUCTIONS = [
  'You are the sous-chef ("AI") sharing one small kitchen with a human cook.',
  'The state describes what the human is doing right now and what the kitchen contains.',
  'Choose the single next action for yourself from the options.',
  'Complement the human: do not start the same task at the same station they are using.',
  'Keep the pipeline moving, but never fight the human for a station or an ingredient.',
  'If the state contains a "policy", that policy overrides these defaults.',
  'The policy may be written in Japanese; interpret it faithfully.',
].join(' ');

export function buildQuestions(cands) {
  const criteria = {};
  for (const c of cands) {
    const at = c.station ? `（${STATIONS[c.station].name}）` : '';
    criteria[c.id] = `${c.label}${at}`;
  }
  return {
    next_action: { type: 'choice', instructions: ACTION_INSTRUCTIONS, criteria },
  };
}

/** What Jev sees. Observation only — the action list travels in the Choice criteria. */
export function observe(g, policy) {
  const b = g.stations.board;
  return {
    policy: policy && policy.trim() ? policy.trim() : null,
    human: {
      carrying: g.human.carrying,
      at_station: g.human.station,
      last_action: g.human.action,
      recent_actions: g.human.lastActions.slice(-4).map((a) => a.label),
    },
    ai: { carrying: g.ai.carrying, last_action: g.ai.action },
    board: b.state,
    board_operator: b.state === 'chopping' ? b.by : null,
    orders_served: g.served,
  };
}

const RULE_ORDER = ['serve', 'plate', 'chop', 'fetch_plate', 'fetch_tomato', 'wait'];

/**
 * Fixed-rule baseline. Same candidate list, same politeness idea, no policy
 * understanding — it is the honest "competent but literal" comparator.
 */
export function rulePick(g, cands) {
  const h = g.human;
  const usable = cands.filter((c) => {
    if (c.station && c.station === h.station) return false;
    if (c.id === 'fetch_tomato' && (h.carrying === 'tomato' || h.station === 'crate')) return false;
    if (c.id === 'fetch_plate' && (h.carrying === 'plate' || h.station === 'plates')) return false;
    return true;
  });
  const pool = usable.length ? usable : cands;
  return [...pool].sort((a, b) => RULE_ORDER.indexOf(a.id) - RULE_ORDER.indexOf(b.id))[0];
}
