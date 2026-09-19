import { STAFF } from './staff.js';

// Both cooks use the same mechanics. Jev selects only from feasible actions.
export const REACH = 68;
export const SPEED = 225;
export const CHOP_MS = 1600;
export const COOK_MS = 4200;
export const GRILL_MS = 3500;
export const POT_BURN_MS = 12_000;
export const GRILL_BURN_MS = 7000;
export const SHIFT_MS = 90_000;
export const STAR_SCORES = [600, 1800, 3600];
export const MAX_LEVEL = 100;
export const STOCK_PRICE = 8;
export const BOOST_MIN = 0.25;
export const BOOST_MAX = 0.65;
export const STATIONS = {
  crate: { name: 'トマト', x: 155, y: 190, dx: 0, dy: -84 },
  board: { name: 'まな板', x: 390, y: 190, dx: 0, dy: -84 },
  pot: { name: 'スープ鍋', x: 930, y: 190, dx: 0, dy: -84 },
  grill: { name: 'グリル', x: 1130, y: 320, dx: 84, dy: 0 },
  plates: { name: 'お皿', x: 755, y: 285, dx: 84, dy: 0 },
  serve: { name: '配膳', x: 455, y: 390, dx: 0, dy: 82 },
};
export const STATION_IDS = Object.keys(STATIONS);
export const ITEM_EMOJI = {
  tomato: '🍅',
  chopped: '🍅',
  plate: '🍽️',
  dish: '🥗',
  soup: '🍲',
  roast: '🍢',
};
export const ITEM_NAMES = {
  tomato: 'トマト',
  chopped: '切ったトマト',
  plate: 'お皿',
  dish: 'サラダ',
  soup: 'スープ',
  roast: '焼きトマト',
};
export const RECIPES = {
  dish: { name: 'トマトサラダ', points: 100 },
  soup: { name: 'トマトスープ', points: 140 },
  roast: { name: '焼きトマト', points: 180 },
};
export function levelConfig(level = 1) {
  const numericLevel = Number(level);
  const normalized = Number.isFinite(numericLevel)
    ? Math.min(MAX_LEVEL, Math.max(1, Math.floor(numericLevel)))
    : 1;
  const kitchenTier = Math.min(3, normalized);
  const progress = Math.max(0, (normalized - 3) / (MAX_LEVEL - 3));
  const soup = kitchenTier >= 2 ? 0.4 - 0.05 * progress : 0;
  const roast = kitchenTier >= 3 ? 0.2 + 0.1 * progress : 0;
  return Object.freeze({
    level: normalized,
    kitchenTier,
    stockFinite: normalized >= 2,
    quota: 4 + 2 * kitchenTier + Math.round(4 * Math.sqrt(progress)),
    orderWindowMs: Math.round((18 + 18 / (1 + 0.7 * Math.log2(normalized))) * 1000),
    recipeMix: { dish: 1 - soup - roast, soup, roast },
  });
}

export function quotaForLevel(level) {
  return levelConfig(level).quota;
}

function stockAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
}

function nextRecipe(g) {
  const { dish, soup } = levelConfig(g.level).recipeMix;
  // Evenly spaced draws avoid random streaks and keep retries reproducible.
  const draw = (0.9 + g.nextOrder * ((Math.sqrt(5) - 1) / 2)) % 1;
  return draw < dish ? 'dish' : draw < dish + soup ? 'soup' : 'roast';
}

function order(g, deadline, recipe = nextRecipe(g)) {
  const id = g.nextOrder++;
  return { id, recipe, deadline, duration: deadline - g.time };
}

function orderWindowMs(g) {
  return levelConfig(g.level).orderWindowMs;
}

function initialOrderDeadline(g, index) {
  const window = orderWindowMs(g);
  return g.time + (index === 0 ? window : Math.round(window * (4 / 3)));
}

function syncConfig(g) {
  const config = levelConfig(g.practice ? 1 : g.level);
  g.level = config.level;
  g.duration = g.practice ? Infinity : SHIFT_MS;
  g.quota = g.practice ? 1 : config.quota;
  if (g.practice || !config.stockFinite) g.stock = null;
  else g.stock = stockAmount(g.stock);
  return g.level;
}

function staffProfile(g) {
  return STAFF[g.staffId] ?? STAFF.helper;
}

function canOperate(g, who, capability) {
  return who === 'human' || staffProfile(g).capabilities?.includes(capability);
}

function capabilityFailure(g, who, capability) {
  return canOperate(g, who, capability)
    ? null
    : { ok: false, reason: `相棒は${capability}担当ではありません` };
}

function actionCapability(id) {
  if (['fetch_tomato', 'chop'].includes(id)) return 'prep';
  if (['collect', 'cook', 'grill', 'clean_pot', 'clean_grill'].includes(id)) return 'cook';
  if (['fetch_plate', 'plate', 'plate_soup', 'plate_roast', 'assemble', 'serve'].includes(id))
    return 'serve';
  return null;
}

function cookDuration(g, who, stationId) {
  const base = stationId === 'grill' ? GRILL_MS : COOK_MS;
  return who === 'ai' ? Math.round(base * staffProfile(g).cook) : base;
}

function chopDuration(g, who) {
  return who === 'ai' ? Math.round(CHOP_MS * staffProfile(g).chop) : CHOP_MS;
}

export function activeStationIds(g) {
  const { kitchenTier } = levelConfig(g.practice ? 1 : g.level);
  return kitchenTier >= 3
    ? ['crate', 'board', 'pot', 'grill', 'plates', 'serve']
    : kitchenTier >= 2
      ? ['crate', 'board', 'pot', 'plates', 'serve']
      : ['crate', 'board', 'plates', 'serve'];
}

export function kitchenBounds(g) {
  const active = activeStationIds(g);
  return {
    minX: 85,
    maxX: active.includes('grill') ? 1175 : active.includes('pot') ? 975 : 775,
    minY: 175,
    maxY: 402,
  };
}

export function createGame({
  practice = false,
  level = 1,
  cash = 120,
  staffId = 'helper',
  hired = ['helper'],
  stock = null,
} = {}) {
  const initialConfig = levelConfig(practice ? 1 : level);
  const initialLevel = initialConfig.level;
  const initialCash = Number.isFinite(Number(cash)) ? Math.max(0, Math.floor(Number(cash))) : 120;
  const initialStaff = Object.hasOwn(STAFF, staffId) ? staffId : 'helper';
  const roster = Array.isArray(hired) ? hired : [];
  const initialHired = [
    ...new Set(['helper', initialStaff, ...roster.filter((id) => Object.hasOwn(STAFF, id))]),
  ];
  const initialStock = practice || !initialConfig.stockFinite ? null : stockAmount(stock);
  const g = {
    practice,
    level: initialLevel,
    duration: practice ? Infinity : SHIFT_MS,
    quota: practice ? 1 : initialConfig.quota,
    cash: initialCash,
    staffId: initialStaff,
    hired: initialHired,
    stock: initialStock,
    time: 0,
    served: 0,
    score: 0,
    burned: 0,
    combo: 0,
    bestCombo: 0,
    missed: 0,
    lastServeAt: -Infinity,
    nextOrder: 0,
    orders: [],
    stations: {
      crate: {},
      board: {
        state: 'idle',
        busyUntil: 0,
        by: null,
        startedAt: 0,
        duration: 0,
        boosted: false,
        quality: false,
      },
      pot: {
        state: 'idle',
        busyUntil: 0,
        by: null,
        startedAt: 0,
        duration: 0,
        burnAt: 0,
        boosted: false,
        quality: false,
      },
      grill: {
        state: 'idle',
        busyUntil: 0,
        by: null,
        startedAt: 0,
        duration: 0,
        burnAt: 0,
        boosted: false,
        quality: false,
      },
      plates: {},
      serve: {},
    },
    human: {
      x: 310,
      y: 300,
      carrying: null,
      station: null,
      action: null,
      quality: false,
      lastActions: [],
      dashUntil: 0,
      dashReadyAt: 0,
    },
    ai: {
      x: 550,
      y: 300,
      carrying: null,
      station: null,
      action: null,
      quality: false,
      intent: null,
    },
  };
  g.orders = practice
    ? [order(g, Infinity, 'dish')]
    : [order(g, initialOrderDeadline(g, 0)), order(g, initialOrderDeadline(g, 1))];
  return g;
}

export function completeOnboarding(g) {
  if (!g?.practice) return g;
  const served = g.served;
  const score = g.score;
  const humanPosition = { x: g.human.x, y: g.human.y };
  const fresh = createGame({
    level: 1,
    cash: g.cash,
    staffId: g.staffId,
    hired: g.hired,
  });
  Object.assign(g, fresh, {
    served,
    score,
    human: { ...fresh.human, ...humanPosition },
  });
  return g;
}

export function stationAt(g, who) {
  const e = g[who];
  let id = null;
  let dist = Infinity;
  for (const key of activeStationIds(g)) {
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
  if ((!g.practice && g.time >= g.duration) || g.time < g.human.dashReadyAt) return false;
  g.human.dashUntil = g.time + 220;
  g.human.dashReadyAt = g.time + 1800;
  return true;
}

function resetHeat(st) {
  st.state = 'idle';
  st.busyUntil = 0;
  st.by = null;
  st.startedAt = 0;
  st.duration = 0;
  st.burnAt = 0;
  st.boosted = false;
  st.quality = false;
}

function startHeat(g, who, stationId, st, quality = false) {
  st.state = 'cooking';
  st.startedAt = g.time;
  st.duration = cookDuration(g, who, stationId);
  st.busyUntil = g.time + st.duration;
  st.burnAt = 0;
  st.boosted = false;
  st.quality = Boolean(quality);
  st.by = who;
}

function tryBoost(g, who, st) {
  if (g.practice) return { ok: false, reason: '練習では切り終わるまで待とう' };
  if (who !== 'human') return { ok: false, reason: '相棒は自動で仕上げるよ' };
  if (st.boosted || !['chopping', 'cooking'].includes(st.state) || g.time < st.startedAt)
    return { ok: false, reason: '今は仕上げられないよ' };
  const progress = (g.time - st.startedAt) / st.duration;
  if (progress < BOOST_MIN || progress > BOOST_MAX)
    return { ok: false, reason: '仕上げの合図を待とう' };
  st.busyUntil = g.time + Math.max(350, Math.round((st.busyUntil - g.time) * 0.45));
  st.boosted = true;
  st.quality = true;
  return { ok: true, action: '調理を早めた', quality: true };
}

export function interact(g, who, stationId) {
  syncConfig(g);
  const e = g[who],
    st = g.stations[stationId];
  if (!st) return { ok: false, reason: 'ここでは作業できません' };
  if (!g.practice && g.time >= g.duration) return { ok: false, reason: '営業時間外です' };
  if (!activeStationIds(g).includes(stationId)) return { ok: false, reason: 'まだ準備中です' };
  const success = (action) => ({ ok: true, action });
  const boostStation =
    (stationId === 'board' && st.state === 'chopping') ||
    ((stationId === 'pot' || stationId === 'grill') && st.state === 'cooking');
  if (boostStation) {
    if (!e.carrying) return tryBoost(g, who, st);
  }
  switch (stationId) {
    case 'crate':
      if (!e.carrying) {
        const denied = capabilityFailure(g, who, 'prep');
        if (denied) return denied;
        if (g.stock !== null && g.stock <= 0)
          return { ok: false, reason: 'トマトの在庫がありません' };
        e.carrying = 'tomato';
        e.quality = false;
        if (g.stock !== null) g.stock--;
        return success('トマトを取った');
      }
      if (e.carrying === 'tomato') {
        e.carrying = null;
        e.quality = false;
        if (g.stock !== null) g.stock++;
        return success('トマトを戻した');
      }
      return { ok: false, reason: '先に手元の食材を使おう' };
    case 'plates':
      if (e.carrying === 'chopped') {
        const denied = capabilityFailure(g, who, 'serve');
        if (denied) return denied;
        e.carrying = 'dish';
        return success('サラダを盛り付けた');
      }
      if (e.carrying === 'plate') {
        e.carrying = null;
        e.quality = false;
        return success('お皿を戻した');
      }
      if (!e.carrying) {
        const denied = capabilityFailure(g, who, 'serve');
        if (denied) return denied;
        e.carrying = 'plate';
        e.quality = false;
        return success('お皿を取った');
      }
      return { ok: false, reason: 'トマトはまな板へ、料理は配膳口へ' };
    case 'board':
      if (st.state === 'chopping') return { ok: false, reason: 'もう少しで切り終わるよ' };
      if (st.state === 'idle' && e.carrying === 'tomato') {
        const denied = capabilityFailure(g, who, 'prep');
        if (denied) return denied;
        e.carrying = null;
        st.state = 'chopping';
        st.duration = chopDuration(g, who);
        st.startedAt = g.time;
        st.busyUntil = g.time + st.duration;
        st.boosted = false;
        st.by = who;
        st.quality = false;
        return success('トマトを切り始めた');
      }
      if (st.state === 'chopped' && (!e.carrying || e.carrying === 'plate')) {
        const denied = capabilityFailure(g, who, e.carrying === 'plate' ? 'serve' : 'cook');
        if (denied) return denied;
        e.carrying = e.carrying === 'plate' ? 'dish' : 'chopped';
        e.quality = st.quality;
        st.state = 'idle';
        st.by = null;
        st.startedAt = 0;
        st.duration = 0;
        st.boosted = false;
        st.quality = false;
        return success(e.carrying === 'dish' ? 'サラダを盛り付けた' : '切ったトマトを取った');
      }
      return {
        ok: false,
        reason: st.state === 'idle' ? 'トマトを持ってこよう' : '手を空けるか、お皿を持ってこよう',
      };
    case 'pot':
      if (st.state === 'burnt' && !e.carrying) {
        const denied = capabilityFailure(g, who, 'cook');
        if (denied) return denied;
        resetHeat(st);
        return success('焦げを片づけた');
      }
      if (st.state === 'idle' && e.carrying === 'chopped') {
        const denied = capabilityFailure(g, who, 'cook');
        if (denied) return denied;
        e.carrying = null;
        startHeat(g, who, stationId, st, e.quality);
        e.quality = false;
        return success('スープを煮込み始めた');
      }
      if (st.state === 'ready' && e.carrying === 'plate') {
        const denied = capabilityFailure(g, who, 'serve');
        if (denied) return denied;
        e.carrying = 'soup';
        e.quality = e.quality || st.quality;
        resetHeat(st);
        return success('スープを盛り付けた');
      }
      return {
        ok: false,
        reason:
          st.state === 'cooking'
            ? '煮込み中。別の仕事をしよう'
            : st.state === 'burnt'
              ? '鍋を片づけよう'
              : st.state === 'ready'
                ? 'お皿を持ってこよう'
                : '切ったトマトを持ってこよう',
      };
    case 'grill':
      if (st.state === 'burnt' && !e.carrying) {
        const denied = capabilityFailure(g, who, 'cook');
        if (denied) return denied;
        resetHeat(st);
        return success('焦げを片づけた');
      }
      if (st.state === 'idle' && e.carrying === 'chopped') {
        const denied = capabilityFailure(g, who, 'cook');
        if (denied) return denied;
        e.carrying = null;
        startHeat(g, who, stationId, st, e.quality);
        e.quality = false;
        return success('トマトを焼き始めた');
      }
      if (st.state === 'ready' && e.carrying === 'plate') {
        const denied = capabilityFailure(g, who, 'serve');
        if (denied) return denied;
        e.carrying = 'roast';
        e.quality = e.quality || st.quality;
        resetHeat(st);
        return success('焼きトマトを盛り付けた');
      }
      return {
        ok: false,
        reason:
          st.state === 'cooking'
            ? '焼き上がりを待とう'
            : st.state === 'burnt'
              ? 'グリルを片づけよう'
              : st.state === 'ready'
                ? 'お皿を持ってこよう'
                : '切ったトマトを持ってこよう',
      };
    case 'serve': {
      const denied = capabilityFailure(g, who, 'serve');
      if (denied) return denied;
      if (!RECIPES[e.carrying]) return { ok: false, reason: '完成した料理を持ってこよう' };
      advance(g);
      const index = g.orders.findIndex((o) => o.recipe === e.carrying);
      if (index < 0) return { ok: false, reason: 'この料理の注文はまだないよ' };
      const ticket = g.orders[index];
      let points = RECIPES[ticket.recipe].points;
      if (!g.practice) {
        g.combo = g.time - g.lastServeAt <= 12_000 ? Math.min(3, g.combo + 1) : 1;
        points = (points + Math.ceil((ticket.deadline - g.time) / 1000)) * g.combo;
      }
      if (e.quality) points += 30;
      g.score += points;
      g.cash += Math.round(RECIPES[ticket.recipe].points / 4);
      g.served++;
      g.bestCombo = Math.max(g.bestCombo, g.combo);
      g.lastServeAt = g.time;
      g.orders.splice(index, 1);
      syncConfig(g);
      if (!g.practice) {
        g.orders.push(order(g, g.time + orderWindowMs(g)));
      }
      e.carrying = null;
      e.quality = null;
      return { ok: true, action: `${RECIPES[ticket.recipe].name}を配膳した`, points };
    }
  }
  return { ok: false, reason: 'ここでは作業できません' };
}

export function discard(g, who) {
  if (!g[who].carrying || (!g.practice && g.time >= g.duration)) return false;
  g[who].carrying = null;
  g[who].quality = null;
  g.combo = 0;
  return true;
}

export function advance(g, elapsed = 0) {
  syncConfig(g);
  g.time = g.practice
    ? g.time + Math.max(0, elapsed)
    : Math.min(g.duration, g.time + Math.max(0, elapsed));
  const board = g.stations.board;
  if (board.state === 'chopping' && g.time >= board.busyUntil) board.state = 'chopped';
  for (const [id, burnMs] of [
    ['pot', POT_BURN_MS],
    ['grill', GRILL_BURN_MS],
  ]) {
    const st = g.stations[id];
    if (st.state === 'cooking' && g.time >= st.busyUntil) {
      st.state = 'ready';
      st.burnAt = st.busyUntil + burnMs;
    }
    if (st.state === 'ready' && st.burnAt && g.time >= st.burnAt) {
      st.state = 'burnt';
      st.by = null;
      g.burned++;
      g.combo = 0;
    }
  }
  if (g.practice) return;
  if (g.time - g.lastServeAt > 12_000) g.combo = 0;
  if (g.time >= g.duration) return;
  g.orders = g.orders
    .map((o) => {
      if (g.time < o.deadline) return o;
      g.missed++;
      g.combo = 0;
      return order(g, g.time + orderWindowMs(g));
    })
    .sort((a, b) => a.deadline - b.deadline);
}

export function buildCandidates(g, who = 'ai') {
  syncConfig(g);
  const e = g[who],
    b = g.stations.board,
    p = g.stations.pot,
    grill = g.stations.grill,
    active = activeStationIds(g);
  const out = [];
  const add = (id, label, station) => {
    const capability = actionCapability(id);
    if (capability && !canOperate(g, who, capability)) return;
    out.push({ id, label, station });
  };
  const needs = (recipe) => g.orders.some((o) => o.recipe === recipe);
  const canFetchTomato = g.stock === null || g.stock > 0;
  const canBoost = (st) => {
    if (g.practice) return false;
    if (!['chopping', 'cooking'].includes(st.state) || st.boosted || !st.duration) return false;
    const progress = (g.time - st.startedAt) / st.duration;
    return progress >= BOOST_MIN && progress <= BOOST_MAX;
  };
  if (g.practice || g.time < g.duration) {
    if (RECIPES[e.carrying]) {
      if (g.orders.some((o) => o.recipe === e.carrying))
        add('serve', '完成した料理を配膳する', 'serve');
      else add('discard', '注文のない料理を片づける', null);
    }
    if (e.carrying === 'chopped') {
      if (active.includes('pot') && p.state === 'idle' && needs('soup'))
        add('cook', '切ったトマトでスープを煮込む', 'pot');
      if (active.includes('grill') && grill.state === 'idle' && needs('roast'))
        add('grill', '切ったトマトをグリルで焼く', 'grill');
      if (needs('dish') || (!needs('soup') && !needs('roast')))
        add('assemble', '切ったトマトをお皿に盛ってサラダにする', 'plates');
    }
    if (e.carrying === 'plate') {
      if (b.state === 'chopped' && needs('dish')) add('plate', 'サラダを盛り付ける', 'board');
      if (active.includes('pot') && p.state === 'ready' && needs('soup'))
        add('plate_soup', 'スープを盛り付ける', 'pot');
      if (active.includes('grill') && grill.state === 'ready' && needs('roast'))
        add('plate_roast', '焼きトマトを盛り付ける', 'grill');
      add('return_plate', 'お皿を戻して手を空ける', 'plates');
    }
    if (e.carrying === 'tomato') {
      if (b.state === 'idle') add('chop', 'トマトを切り始める', 'board');
      else add('return_tomato', 'トマトを戻して別の仕事を手伝う', 'crate');
    }
    if (!e.carrying) {
      if (b.state === 'idle' && canFetchTomato && g.human.carrying !== 'tomato')
        add('fetch_tomato', 'トマトを取る', 'crate');
      if (
        b.state === 'chopped' &&
        ((active.includes('pot') && p.state === 'idle' && needs('soup')) ||
          (active.includes('grill') && grill.state === 'idle' && needs('roast')))
      )
        add('collect', '切ったトマトを取る', 'board');
      if (active.includes('pot') && p.state === 'burnt')
        add('clean_pot', '焦げた鍋を片づける', 'pot');
      if (active.includes('grill') && grill.state === 'burnt')
        add('clean_grill', '焦げたグリルを片づける', 'grill');
      if (who === 'human' && canBoost(b)) add('boost_board', 'まな板の仕上げを早める', 'board');
      if (who === 'human' && active.includes('pot') && canBoost(p))
        add('boost_pot', '鍋の仕上げを早める', 'pot');
      if (who === 'human' && active.includes('grill') && canBoost(grill))
        add('boost_grill', 'グリルの仕上げを早める', 'grill');
      if (
        (b.state === 'chopped' && needs('dish')) ||
        (active.includes('pot') && p.state === 'ready' && needs('soup')) ||
        (active.includes('grill') && grill.state === 'ready' && needs('roast'))
      )
        add('fetch_plate', 'お皿を用意する', 'plates');
    }
  }
  add('wait', '今は動かず、様子を見る', null);
  return out;
}

// Execution and candidate generation share the same preconditions.
export function isFeasible(g, cand, who = 'ai') {
  return (
    !!cand && buildCandidates(g, who).some((c) => c.id === cand.id && c.station === cand.station)
  );
}

export function buildQuestions(cands) {
  return {
    next_action: {
      type: 'choice',
      instructions:
        "You are the sous-chef sharing a kitchen with a human. Choose one feasible action that complements their work and serves the earliest orders. Salad: tomato → chop → plate → serve. Soup: tomato → chop → collect → pot → plate → serve. Grilled tomato: tomato → chop → collect → grill → plate → serve. Clean burnt cookware before reusing it. Never duplicate the human's current task. Respect their collaboration policy, including Japanese. Avoid unnecessary returning or discarding. Work ahead while food cooks.",
      criteria: Object.fromEntries(cands.map((c) => [c.id, c.label])),
    },
  };
}

export function observe(g, policy) {
  syncConfig(g);
  return {
    practice: g.practice,
    level: g.level,
    quota: g.quota,
    stock: g.stock,
    duration_seconds: Number.isFinite(g.duration) ? Math.ceil(g.duration / 1000) : null,
    cash: g.cash,
    hired: g.hired,
    staff: {
      id: g.staffId,
      name: staffProfile(g).name,
      role: staffProfile(g).role,
      speed: staffProfile(g).speed,
      chop: staffProfile(g).chop,
      cook: staffProfile(g).cook,
      capabilities: staffProfile(g).capabilities,
      can_dash: staffProfile(g).canDash,
      decision_interval_ms: staffProfile(g).decisionMs,
    },
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
    grill: g.stations.grill.state,
    pot_burn_seconds:
      g.stations.pot.state === 'ready'
        ? Math.max(0, Math.ceil((g.stations.pot.burnAt - g.time) / 1000))
        : null,
    grill_burn_seconds:
      g.stations.grill.state === 'ready'
        ? Math.max(0, Math.ceil((g.stations.grill.burnAt - g.time) / 1000))
        : null,
    burned: g.burned,
    quality: { human: g.human.quality, ai: g.ai.quality },
    board_operator: g.stations.board.state === 'chopping' ? g.stations.board.by : null,
    orders: g.orders.map((o) => ({
      recipe: o.recipe,
      seconds_left: g.practice ? null : Math.ceil((o.deadline - g.time) / 1000),
    })),
    seconds_left: g.practice ? null : Math.ceil((g.duration - g.time) / 1000),
    orders_served: g.served,
  };
}

export function rulePick(g, cands) {
  const h = g.human;
  const leadRecipe = [...g.orders].sort((a, b) => a.deadline - b.deadline)[0]?.recipe;
  const role = staffProfile(g).role;
  const rolePriority =
    role === 'runner'
      ? [
          'serve',
          'plate_soup',
          'plate_roast',
          'plate',
          'assemble',
          'fetch_plate',
          'collect',
          'clean_pot',
          'clean_grill',
          'cook',
          'grill',
          'chop',
        ]
      : role === 'chef'
        ? [
            'clean_pot',
            'clean_grill',
            'cook',
            'grill',
            'chop',
            'collect',
            'plate_soup',
            'plate_roast',
            'plate',
            'assemble',
            'fetch_plate',
            'serve',
          ]
        : role === 'expediter'
          ? [
              'serve',
              'clean_pot',
              'clean_grill',
              'plate_soup',
              'plate_roast',
              'plate',
              'cook',
              'grill',
              'collect',
              'chop',
              'assemble',
              'fetch_plate',
            ]
          : [
              'serve',
              'clean_pot',
              'clean_grill',
              ...(leadRecipe === 'soup'
                ? ['cook', 'grill', 'plate_soup', 'plate_roast', 'collect', 'plate', 'assemble']
                : leadRecipe === 'roast'
                  ? ['grill', 'cook', 'plate_roast', 'plate_soup', 'collect', 'plate', 'assemble']
                  : ['plate', 'assemble', 'cook', 'grill', 'collect', 'plate_soup', 'plate_roast']),
              'chop',
              'fetch_plate',
            ];
  const urgentPriority =
    leadRecipe === 'soup'
      ? ['plate_soup', 'cook']
      : leadRecipe === 'roast'
        ? ['plate_roast', 'grill']
        : ['plate', 'assemble'];
  const priority = [...new Set(['serve', ...urgentPriority, ...rolePriority])];
  priority.push('fetch_tomato', 'return_plate', 'return_tomato', 'discard', 'wait');
  const usable = cands.filter((c) => {
    if (c.station && c.station === h.station) return false;
    if (c.id === 'fetch_tomato' && h.carrying === 'tomato') return false;
    if (c.id === 'fetch_plate' && h.carrying === 'plate') return false;
    return true;
  });
  const rank = (candidate) => {
    const index = priority.indexOf(candidate.id);
    return index < 0 ? priority.length : index;
  };
  return [...usable].sort((a, b) => rank(a) - rank(b))[0] ?? cands.find((c) => c.id === 'wait');
}

export function actionHint(g, id) {
  const item = g.human.carrying;
  if (id === 'crate') {
    if (item === 'tomato') return 'トマトを戻す';
    return item ? '手元を空ける' : 'トマトを取る';
  }
  if (id === 'plates') {
    if (item === 'chopped') return 'サラダを盛る';
    if (item === 'plate') return 'お皿を戻す';
    if (item === 'tomato') return 'まな板へ運ぶ';
    if (RECIPES[item]) return '配膳口へ運ぶ';
    return 'お皿を取る';
  }
  if (id === 'board') {
    const board = g.stations.board;
    if (board.state === 'chopping') {
      const progress = board.duration ? (g.time - board.startedAt) / board.duration : 0;
      return !item && !board.boosted && progress >= BOOST_MIN && progress <= BOOST_MAX
        ? '仕上げる'
        : '切り終わるまで待つ';
    }
    if (board.state === 'chopped') {
      if (item === 'plate') return 'サラダを盛る';
      if (!item) return '切ったトマトを取る';
      return '手元を空ける';
    }
    if (item === 'tomato') return 'トマトを切る';
    if (item === 'chopped') return 'お皿の台へ運ぶ';
    return 'トマトを取ってこよう';
  }
  if (id === 'pot') {
    const pot = g.stations.pot;
    if (pot.state === 'cooking') {
      const progress = pot.duration ? (g.time - pot.startedAt) / pot.duration : 0;
      return !item && !pot.boosted && progress >= BOOST_MIN && progress <= BOOST_MAX
        ? '仕上げる'
        : '煮込み中、別の仕事へ';
    }
    if (pot.state === 'burnt') return !item ? '焦げを片づける' : '鍋を片づけよう';
    if (pot.state === 'ready') return item === 'plate' ? 'スープを盛る' : 'お皿を持ってくる';
    if (item === 'chopped') return 'スープを煮る';
    if (RECIPES[item]) return '配膳口へ運ぶ';
    return '切ったトマトを持ってこよう';
  }
  if (id === 'grill') {
    const grill = g.stations.grill;
    if (grill.state === 'cooking') {
      const progress = grill.duration ? (g.time - grill.startedAt) / grill.duration : 0;
      return !item && !grill.boosted && progress >= BOOST_MIN && progress <= BOOST_MAX
        ? '仕上げる'
        : '焼き上がりを待とう';
    }
    if (grill.state === 'burnt') return !item ? '焦げを片づける' : 'グリルを片づけよう';
    if (grill.state === 'ready') return item === 'plate' ? '焼きトマトを盛る' : 'お皿を持ってくる';
    if (item === 'chopped') return 'トマトを焼く';
    return '切ったトマトを持ってこよう';
  }
  if (RECIPES[item]) {
    return g.orders.some((order) => order.recipe === item) ? '配膳する' : 'この料理の注文を待つ';
  }
  return '完成した料理を持ってこよう';
}
