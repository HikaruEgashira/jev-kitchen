// Both cooks use the same mechanics. Jev selects only from feasible actions.
export const REACH = 68;
export const SPEED = 225;
export const CHOP_MS = 1600;
export const COOK_MS = 4200;
export const SHIFT_MS = 90_000;
export const STAR_SCORES = [300, 700, 1200];
export const STATIONS = {
  crate: { name: 'トマト', x: 155, y: 190, dx: 0, dy: -84 },
  board: { name: 'まな板', x: 390, y: 190, dx: 0, dy: -84 },
  pot: { name: 'スープ鍋', x: 630, y: 190, dx: 0, dy: -84 },
  plates: { name: 'お皿', x: 755, y: 285, dx: 84, dy: 0 },
  serve: { name: '配膳', x: 455, y: 390, dx: 0, dy: 82 },
};
export const STATION_IDS = Object.keys(STATIONS);
export const ITEM_EMOJI = { tomato: '🍅', chopped: '🥬', plate: '🍽️', dish: '🥗', soup: '🍲' };
export const ITEM_NAMES = {
  tomato: 'トマト',
  chopped: '切ったトマト',
  plate: 'お皿',
  dish: 'サラダ',
  soup: 'スープ',
};
export const RECIPES = {
  dish: { name: 'トマトサラダ', points: 100 },
  soup: { name: 'トマトスープ', points: 140 },
};
const MENU = ['dish', 'soup', 'dish', 'soup', 'soup', 'dish'];

function order(g, deadline) {
  const id = g.nextOrder++;
  return { id, recipe: MENU[id % MENU.length], deadline, duration: deadline - g.time };
}

export function createGame() {
  const g = {
    time: 0,
    served: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    missed: 0,
    lastServeAt: -Infinity,
    nextOrder: 0,
    orders: [],
    stations: {
      crate: {},
      board: { state: 'idle', busyUntil: 0, by: null },
      pot: { state: 'idle', busyUntil: 0, by: null },
      plates: {},
      serve: {},
    },
    human: {
      x: 310,
      y: 300,
      carrying: null,
      station: null,
      action: null,
      lastActions: [],
      dashUntil: 0,
      dashReadyAt: 0,
    },
    ai: { x: 550, y: 300, carrying: null, station: null, action: null, intent: null },
  };
  g.orders = [0, 1, 2].map((i) => order(g, 36_000 + i * 9000));
  return g;
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
  const dx = x - e.x,
    dy = y - e.y;
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

export function dash(g) {
  if (g.time >= SHIFT_MS || g.time < g.human.dashReadyAt) return false;
  g.human.dashUntil = g.time + 220;
  g.human.dashReadyAt = g.time + 1800;
  return true;
}

export function interact(g, who, stationId) {
  const e = g[who],
    st = g.stations[stationId];
  if (!st || g.time >= SHIFT_MS) return { ok: false, reason: '営業時間外です' };
  const success = (action) => ({ ok: true, action });
  switch (stationId) {
    case 'crate':
      if (!e.carrying) {
        e.carrying = 'tomato';
        return success('トマトを取った');
      }
      if (e.carrying === 'tomato') {
        e.carrying = null;
        return success('トマトを戻した');
      }
      return { ok: false, reason: '先に手元の食材を使おう' };
    case 'plates':
      if (e.carrying === 'chopped') {
        e.carrying = 'dish';
        return success('サラダを盛り付けた');
      }
      if (e.carrying === 'plate') {
        e.carrying = null;
        return success('お皿を戻した');
      }
      if (!e.carrying) {
        e.carrying = 'plate';
        return success('お皿を取った');
      }
      return { ok: false, reason: 'トマトはまな板へ、料理は配膳口へ' };
    case 'board':
      if (st.state === 'chopping') return { ok: false, reason: 'もう少しで切り終わるよ' };
      if (st.state === 'idle' && e.carrying === 'tomato') {
        e.carrying = null;
        st.state = 'chopping';
        st.busyUntil = g.time + CHOP_MS;
        st.by = who;
        return success('トマトを切り始めた');
      }
      if (st.state === 'chopped' && (!e.carrying || e.carrying === 'plate')) {
        e.carrying = e.carrying === 'plate' ? 'dish' : 'chopped';
        st.state = 'idle';
        st.by = null;
        return success(e.carrying === 'dish' ? 'サラダを盛り付けた' : '切ったトマトを取った');
      }
      return {
        ok: false,
        reason: st.state === 'idle' ? 'トマトを持ってこよう' : '手を空けるか、お皿を持ってこよう',
      };
    case 'pot':
      if (st.state === 'idle' && e.carrying === 'chopped') {
        e.carrying = null;
        st.state = 'cooking';
        st.busyUntil = g.time + COOK_MS;
        st.by = who;
        return success('スープを煮込み始めた');
      }
      if (st.state === 'ready' && e.carrying === 'plate') {
        e.carrying = 'soup';
        st.state = 'idle';
        st.by = null;
        return success('スープを盛り付けた');
      }
      return {
        ok: false,
        reason:
          st.state === 'cooking'
            ? '煮込み中。別の仕事をしよう'
            : st.state === 'ready'
              ? 'お皿を持ってこよう'
              : '切ったトマトを持ってこよう',
      };
    case 'serve': {
      if (!RECIPES[e.carrying]) return { ok: false, reason: '完成した料理を持ってこよう' };
      advance(g);
      const index = g.orders.findIndex((o) => o.recipe === e.carrying);
      if (index < 0) return { ok: false, reason: 'この料理の注文はまだないよ' };
      const ticket = g.orders[index];
      g.combo = g.time - g.lastServeAt <= 12_000 ? Math.min(3, g.combo + 1) : 1;
      const points =
        (RECIPES[ticket.recipe].points + Math.ceil((ticket.deadline - g.time) / 1000)) * g.combo;
      g.score += points;
      g.served++;
      g.bestCombo = Math.max(g.bestCombo, g.combo);
      g.lastServeAt = g.time;
      g.orders.splice(index, 1);
      g.orders.push(order(g, g.time + Math.max(26_000, 40_000 - g.served * 1000)));
      e.carrying = null;
      return { ok: true, action: `${RECIPES[ticket.recipe].name}を配膳した`, points };
    }
  }
  return { ok: false, reason: 'ここでは作業できません' };
}

export function discard(g, who) {
  if (!g[who].carrying || g.time >= SHIFT_MS) return false;
  g[who].carrying = null;
  g.combo = 0;
  return true;
}

export function advance(g, elapsed = 0) {
  g.time = Math.min(SHIFT_MS, g.time + Math.max(0, elapsed));
  for (const [id, active, done] of [
    ['board', 'chopping', 'chopped'],
    ['pot', 'cooking', 'ready'],
  ]) {
    const st = g.stations[id];
    if (st.state === active && g.time >= st.busyUntil) st.state = done;
  }
  if (g.time - g.lastServeAt > 12_000) g.combo = 0;
  if (g.time >= SHIFT_MS) return;
  g.orders = g.orders
    .map((o) => {
      if (g.time < o.deadline) return o;
      g.missed++;
      g.combo = 0;
      return order(g, g.time + 36_000);
    })
    .sort((a, b) => a.deadline - b.deadline);
}

export function buildCandidates(g, who = 'ai') {
  const e = g[who],
    b = g.stations.board,
    p = g.stations.pot;
  const out = [];
  const add = (id, label, station) => out.push({ id, label, station });
  if (g.time < SHIFT_MS) {
    if (RECIPES[e.carrying]) {
      if (g.orders.some((o) => o.recipe === e.carrying))
        add('serve', '完成した料理を配膳する', 'serve');
      else add('discard', '注文のない料理を片づける', null);
    }
    if (e.carrying === 'chopped') {
      if (p.state === 'idle') add('cook', '切ったトマトでスープを煮込む', 'pot');
      add('assemble', '切ったトマトをお皿に盛ってサラダにする', 'plates');
    }
    if (e.carrying === 'plate') {
      if (b.state === 'chopped') add('plate', 'サラダを盛り付ける', 'board');
      if (p.state === 'ready') add('plate_soup', 'スープを盛り付ける', 'pot');
      if (b.state === 'idle' && p.state === 'idle')
        add('return_plate', 'お皿を戻して手を空ける', 'plates');
    }
    if (e.carrying === 'tomato') {
      if (b.state === 'idle') add('chop', 'トマトを切り始める', 'board');
      else add('return_tomato', 'トマトを戻して別の仕事を手伝う', 'crate');
    }
    if (!e.carrying) {
      if (b.state === 'idle') add('fetch_tomato', 'トマトを取る', 'crate');
      if (b.state === 'chopped') add('collect', '切ったトマトを取る', 'board');
      if (b.state !== 'idle' || p.state !== 'idle') add('fetch_plate', 'お皿を用意する', 'plates');
    }
  }
  add('wait', '今は動かず、様子を見る', null);
  return out;
}

// Execution and candidate generation share the same preconditions.
export function isFeasible(g, cand) {
  return !!cand && buildCandidates(g).some((c) => c.id === cand.id && c.station === cand.station);
}

export function buildQuestions(cands) {
  return {
    next_action: {
      type: 'choice',
      instructions:
        "You are the sous-chef sharing a kitchen with a human. Choose one feasible action that complements their work and serves the earliest orders. Salad: tomato → chop → plate. Soup: tomato → chop → collect → cook → plate. Never duplicate the human's current task. Respect their collaboration policy, including Japanese. Avoid unnecessary returning or discarding. Work ahead while food cooks.",
      criteria: Object.fromEntries(cands.map((c) => [c.id, c.label])),
    },
  };
}

export function observe(g, policy) {
  return {
    policy: policy?.trim() || null,
    human: {
      carrying: g.human.carrying,
      at_station: g.human.station,
      last_action: g.human.action,
      recent_actions: g.human.lastActions.slice(-4).map((a) => a.label),
    },
    ai: { carrying: g.ai.carrying, last_action: g.ai.action },
    board: g.stations.board.state,
    pot: g.stations.pot.state,
    board_operator: g.stations.board.state === 'chopping' ? g.stations.board.by : null,
    orders: g.orders.map((o) => ({
      recipe: o.recipe,
      seconds_left: Math.ceil((o.deadline - g.time) / 1000),
    })),
    seconds_left: Math.ceil((SHIFT_MS - g.time) / 1000),
    orders_served: g.served,
  };
}

export function rulePick(g, cands) {
  const h = g.human;
  const soupFirst = g.orders[0]?.recipe === 'soup';
  const priority = [
    'serve',
    'plate_soup',
    ...(soupFirst
      ? ['cook', 'collect', 'plate', 'assemble']
      : ['plate', 'assemble', 'cook', 'collect']),
    'chop',
    'fetch_plate',
    'fetch_tomato',
    'return_plate',
    'return_tomato',
    'discard',
    'wait',
  ];
  const usable = cands.filter((c) => {
    if (c.station && c.station === h.station) return false;
    if (c.id === 'fetch_tomato' && h.carrying === 'tomato') return false;
    if (c.id === 'fetch_plate' && h.carrying === 'plate') return false;
    if (c.id === 'fetch_plate' && soupFirst && g.stations.pot.state === 'idle') return false;
    if (c.id === 'collect' && (!soupFirst || g.stations.pot.state !== 'idle')) return false;
    return true;
  });
  return (
    [...usable].sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id))[0] ??
    cands.find((c) => c.id === 'wait')
  );
}

export function actionHint(g, id) {
  const item = g.human.carrying;
  if (id === 'crate') return item === 'tomato' ? 'トマトを戻す' : 'トマトを取る';
  if (id === 'plates')
    return item === 'chopped' ? 'サラダを盛る' : item === 'plate' ? 'お皿を戻す' : 'お皿を取る';
  if (id === 'board')
    return item === 'tomato'
      ? 'トマトを切る'
      : item === 'plate'
        ? 'サラダを盛る'
        : '切ったトマトを取る';
  if (id === 'pot') return item === 'plate' ? 'スープを盛る' : 'スープを煮る';
  return '料理を配膳する';
}
