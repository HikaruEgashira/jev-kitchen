import { STAFF, staffAvailable, nextDuty, payroll } from './staff.js';
import {
  equipmentBurnMultiplier,
  equipmentDurationMultiplier,
  equipmentState,
  stationKind,
} from './equipment.js';
import { levelConfig } from './progression.js';
import { trainingMultiplier, trainingState } from './training.js';

export { levelConfig, quotaForLevel, MAX_LEVEL } from './progression.js';
export {
  equipmentBurnMultiplier,
  equipmentDurationMultiplier,
  equipmentState,
  stationKind,
} from './equipment.js';

// Both cooks use the same mechanics. Jev selects only from feasible actions.
export const REACH = 68;
export const SPEED = 225;
export const CHOP_MS = 1600;
export const COOK_MS = 12_000;
export const GRILL_MS = 7000;
export const POT_BURN_MS = 12_000;
export const GRILL_BURN_MS = 7000;
export const SHIFT_MS = 90_000;
export const STAR_SCORES = [600, 1800, 3600];
export const STOCK_PRICE = 8;
export const BOOST_MIN = 0.25;
export const BOOST_MAX = 0.65;
export const STATIONS = {
  crate: { name: 'トマト', x: 155, y: 190, dx: 0, dy: -84 },
  board: { name: 'まな板', x: 390, y: 190, dx: 0, dy: -84 },
  board2: { name: 'まな板2', x: 620, y: 190, dx: 0, dy: -84 },
  pot: { name: 'スープ鍋', x: 930, y: 190, dx: 0, dy: -84 },
  pot2: { name: 'スープ鍋2', x: 930, y: 390, dx: 0, dy: 82 },
  grill: { name: 'グリル', x: 1130, y: 320, dx: 84, dy: 0 },
  grill2: { name: 'グリル2', x: 1130, y: 190, dx: 84, dy: 0 },
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

// Stock survives the shift: keep selling after quota, without spending payroll.
export function recommendedStock(g) {
  const quota = levelConfig(g.level + 1).quota;
  const target = Math.max(quota + 6, g.served + 4);
  const affordable = Math.floor((g.cash - payroll(nextDuty(g))) / STOCK_PRICE);
  return Math.min(
    99,
    Math.max(0, quota - (g.stock ?? 0), Math.min(affordable, target - (g.stock ?? 0))),
  );
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
  g.equipment = equipmentState(g.equipment);
  g.level = config.level;
  g.duration = g.practice ? Infinity : SHIFT_MS;
  g.quota = g.practice ? 1 : config.quota;
  if (g.practice || !config.stockFinite) g.stock = null;
  else g.stock = stockAmount(g.stock);
  return g.level;
}

function staffSlotsFor(level, practice = false) {
  const slots = levelConfig(practice ? 1 : level).staffSlots;
  return Number.isSafeInteger(slots) && slots >= 0 ? slots : Infinity;
}

function normalizeDuty(g) {
  if (!Array.isArray(g.duty)) return [];
  const limit = staffSlotsFor(g.level, g.practice);
  const duty = [...new Set(g.duty)].filter(
    (id) => Object.hasOwn(g.crew ?? {}, id) && staffAvailable(g.staffState, id),
  );
  g.duty = Number.isFinite(limit) ? duty.slice(0, limit) : duty;
  return g.duty;
}

function resolveWho(g, who) {
  return who ?? g.duty?.[0] ?? null;
}

function makeActor(x, y) {
  return {
    served: 0,
    x,
    y,
    carrying: null,
    station: null,
    action: null,
    quality: false,
    lastActions: [],
    intent: null,
    dashUntil: 0,
    dashReadyAt: 0,
  };
}

function makeBoardStation() {
  return {
    state: 'idle',
    busyUntil: 0,
    by: null,
    startedAt: 0,
    duration: 0,
    boosted: false,
    quality: false,
  };
}

function makeHeatStation() {
  return {
    state: 'idle',
    busyUntil: 0,
    by: null,
    startedAt: 0,
    duration: 0,
    burnAt: 0,
    boosted: false,
    quality: false,
  };
}

export function actor(g, who) {
  const id = who === 'ai' ? (g?.staffId ?? g?.duty?.[0]) : resolveWho(g, who);
  return id === 'human' ? (g?.human ?? null) : (g?.crew?.[id] ?? null);
}

export function staffProfile(g, who) {
  const id = who === 'ai' ? (g?.staffId ?? g?.duty?.[0]) : who;
  return id && id !== 'human' ? (STAFF[id] ?? null) : null;
}

function canOperate(g, who, capability) {
  return who === 'human' || staffProfile(g, who)?.capabilities?.includes(capability);
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
  const base = stationKind(stationId) === 'grill' ? GRILL_MS : COOK_MS;
  const profile = staffProfile(g, who);
  const multiplier = Number(equipmentDurationMultiplier(g.equipment, stationKind(stationId)));
  const equipmentFactor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.round(
    base *
      equipmentFactor *
      trainingMultiplier(g.training, trainedWho(g, who), 'cook') *
      (profile?.cook ?? 1),
  );
}

function chopDuration(g, who, stationId = 'board') {
  const profile = staffProfile(g, who);
  const multiplier = Number(equipmentDurationMultiplier(g.equipment, stationKind(stationId)));
  const equipmentFactor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.round(
    CHOP_MS *
      equipmentFactor *
      trainingMultiplier(g.training, trainedWho(g, who), 'cook') *
      (profile?.chop ?? 1),
  );
}

// `ai` is a selector, not an actor id; training is stored per real actor id.
function trainedWho(g, who) {
  return who === 'ai' ? (g?.staffId ?? g?.duty?.[0]) : who;
}

export function activeStationIds(g = {}) {
  const { kitchenTier } = levelConfig(g.practice ? 1 : g.level);
  const equipment = equipmentState(g.equipment);
  const active = ['crate', 'board'];
  if (equipment.board.count >= 2) active.push('board2');
  if (kitchenTier >= 2) {
    active.push('pot');
    if (equipment.pot.count >= 2) active.push('pot2');
  }
  if (kitchenTier >= 3) {
    active.push('grill');
    if (equipment.grill.count >= 2) active.push('grill2');
  }
  active.push('plates', 'serve');
  return active;
}

const WARMER_SLOT = { name: '保温台', x: 680, y: 390, dx: 0, dy: 82 };
const EXPANSION_SLOTS = {
  top_extra: { name: '拡張台（上）', x: 1390, y: 190, dx: 0, dy: -84 },
  bottom_extra: { name: '拡張台（下）', x: 1390, y: 390, dx: 0, dy: 82 },
};

export function kitchenBounds(g = {}) {
  const active = activeStationIds(g);
  const kitchenLevel = equipmentState(g.equipment).kitchen.level;
  const baseMaxX = active.includes('grill') ? 1175 : active.includes('pot') ? 975 : 775;
  return {
    minX: 85,
    maxX: baseMaxX + (kitchenLevel - 1) * 130,
    minY: 175,
    maxY: 402,
  };
}

function slotInBounds(slot, bounds) {
  return (
    slot.x >= bounds.minX && slot.x <= bounds.maxX && slot.y >= bounds.minY && slot.y <= bounds.maxY
  );
}

export function layoutSlots(g = {}) {
  const bounds = kitchenBounds(g);
  const slots = {};
  for (const id of STATION_IDS) {
    if (slotInBounds(STATIONS[id], bounds)) slots[id] = { ...STATIONS[id] };
  }
  if (slotInBounds(WARMER_SLOT, bounds)) slots.warmer = { ...WARMER_SLOT };
  for (const [id, slot] of Object.entries(EXPANSION_SLOTS)) {
    if (slotInBounds(slot, bounds)) slots[id] = { ...slot };
  }
  return slots;
}

export function resolveLayout(g = {}, proposed = {}) {
  if (
    proposed === null ||
    typeof proposed !== 'object' ||
    Array.isArray(proposed) ||
    Object.getOwnPropertySymbols(proposed).length
  )
    return null;
  const active = [...activeStationIds(g)];
  if (equipmentState(g.equipment).warmer.count > 0) active.push('warmer');
  const slots = layoutSlots(g);
  if (!active.every((id) => Object.hasOwn(slots, id))) return null;
  const available = new Set(Object.keys(slots));
  const result = {};
  const used = new Set();
  for (const [id, slot] of Object.entries(proposed)) {
    if (!active.includes(id) || !available.has(slot) || used.has(slot)) return null;
    result[id] = slot;
    used.add(slot);
  }
  for (const id of active) {
    if (Object.hasOwn(result, id)) continue;
    const slot = [id, ...available].find((candidate) => !used.has(candidate));
    if (!slot) return null;
    result[id] = slot;
    used.add(slot);
  }
  return result;
}

export function stationInfo(g, id) {
  const base = STATIONS[id] ?? (id === 'warmer' ? WARMER_SLOT : null);
  if (!base) return null;
  const slots = layoutSlots(g);
  const slot = slots[g?.layout?.[id]] ?? slots[id] ?? base;
  return { ...base, x: slot.x, y: slot.y, dx: slot.dx, dy: slot.dy };
}

export function createGame({
  practice = false,
  level = 1,
  cash = 120,
  staffId = 'helper',
  hired = ['helper'],
  duty,
  staffState = {},
  stock = null,
  equipment,
  layout,
  training,
} = {}) {
  const initialConfig = levelConfig(practice ? 1 : level);
  const initialLevel = initialConfig.level;
  practice = initialLevel === 1;
  const initialCash = Number.isFinite(Number(cash)) ? Math.max(0, Math.floor(Number(cash))) : 120;
  const initialStaff = Object.hasOwn(STAFF, staffId) ? staffId : 'helper';
  const roster = Array.isArray(hired) ? hired : [];
  const requestedDuty = initialConfig.partner
    ? [initialConfig.partner]
    : Array.isArray(duty)
      ? duty
      : [initialStaff];
  const initialHired = [...new Set(['helper', ...roster, ...requestedDuty])].filter((id) =>
    Object.hasOwn(STAFF, id),
  );
  const normalizedStaffState = Object.fromEntries(
    initialHired.map((id) => {
      const profile = STAFF[id];
      const supplied = staffState?.[id] ?? {};
      if (!initialConfig.fatigueEnabled) return [id, { worked: 0, rest: 0 }];
      const worked = Number.isSafeInteger(supplied.worked)
        ? Math.max(0, Math.min(profile.maxConsecutive - 1, supplied.worked))
        : 0;
      const rest = Number.isSafeInteger(supplied.rest)
        ? Math.max(0, Math.min(profile.restShifts, supplied.rest))
        : 0;
      return [id, { worked: rest > 0 ? 0 : worked, rest }];
    }),
  );
  const initialDuty = [...new Set(requestedDuty)].filter(
    (id) => initialHired.includes(id) && staffAvailable(normalizedStaffState, id),
  );
  const dutyLimit = staffSlotsFor(initialLevel, practice);
  if (Number.isFinite(dutyLimit)) initialDuty.splice(dutyLimit);
  const initialStock = practice || !initialConfig.stockFinite ? null : stockAmount(stock);
  const g = {
    practice,
    level: initialLevel,
    duration: practice ? Infinity : SHIFT_MS,
    staffId: initialDuty[0] ?? initialStaff,
    quota: practice ? 1 : initialConfig.quota,
    cash: initialCash,
    hired: initialHired,
    duty: initialDuty,
    staffState: normalizedStaffState,
    stock: initialStock,
    equipment: equipmentState(equipment),
    training: trainingState(training),
    time: 0,
    served: 0,
    score: 0,
    burned: 0,
    rushSpawned: false,
    combo: 0,
    bestCombo: 0,
    missed: 0,
    lastServeAt: -Infinity,
    nextOrder: 0,
    orders: [],
    stations: {
      crate: {},
      board: makeBoardStation(),
      board2: makeBoardStation(),
      pot: makeHeatStation(),
      pot2: makeHeatStation(),
      grill: makeHeatStation(),
      grill2: makeHeatStation(),
      plates: {},
      serve: {},
    },
    human: makeActor(310, 300),
    crew: Object.fromEntries(
      initialDuty.map((id, index) => [
        id,
        makeActor(520 + (index % 3) * 60, 255 + Math.floor(index / 3) * 60),
      ]),
    ),
  };
  g.layout = resolveLayout(g, layout) ?? resolveLayout(g);
  g.ai = g.crew[g.staffId] ?? null;
  g.orders = practice
    ? [order(g, Infinity, 'dish')]
    : [order(g, initialOrderDeadline(g, 0)), order(g, initialOrderDeadline(g, 1))];
  return g;
}

export function stationAt(g, who) {
  const e = actor(g, who);
  if (!e) return { id: null, dist: Infinity, inReach: false };
  let id = null;
  let dist = Infinity;
  for (const key of activeStationIds(g)) {
    const s = stationInfo(g, key);
    if (!s) continue;
    const d = Math.hypot(e.x - s.x, e.y - s.y);
    if (d < dist) {
      dist = d;
      id = key;
    }
  }
  return { id, dist, inReach: dist <= REACH };
}

function stationName(g, id) {
  return stationInfo(g, id)?.name ?? STATIONS[id]?.name ?? id;
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

export function movePlayer(g, ax, ay, step, movementMode = 'screen') {
  const dx = movementMode === 'grid' ? ax : ax * 0.874 + ay * 0.486;
  const dy = movementMode === 'grid' ? ay : -ax * 0.486 + ay * 0.874;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const bounds = kitchenBounds(g);
  g.human.x = Math.max(bounds.minX, Math.min(bounds.maxX, g.human.x + (dx / length) * step));
  g.human.y = Math.max(bounds.minY, Math.min(bounds.maxY, g.human.y + (dy / length) * step));
}

export function dash(g, who = 'human') {
  const e = actor(g, who);
  const profile = staffProfile(g, who);
  if (!e || (who !== 'human' && !profile?.canDash)) return false;
  if ((!g.practice && g.time >= g.duration) || g.time < e.dashReadyAt) return false;
  e.dashUntil = g.time + 220;
  e.dashReadyAt = g.time + 1800;
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

export function burnGraceMs(g, stationId) {
  const kind = stationKind(stationId);
  if (g.practice || !levelConfig(g.level).burningEnabled) return 0;
  if (kind !== 'pot' && kind !== 'grill') return 0;
  const base = kind === 'grill' ? GRILL_BURN_MS : POT_BURN_MS;
  const multiplier = Number(equipmentBurnMultiplier(g.equipment));
  return Math.round(base * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1));
}

function boostAvailable(g, st) {
  if (g.practice || !levelConfig(g.level).boostEnabled) return false;
  if (!['chopping', 'cooking'].includes(st.state) || st.boosted || !st.duration) return false;
  const progress = (g.time - st.startedAt) / st.duration;
  return progress >= BOOST_MIN && progress <= BOOST_MAX;
}

function tryBoost(g, who, st) {
  if (who !== 'human') return { ok: false, reason: '相棒は自動で仕上げるよ' };
  if (!boostAvailable(g, st)) return { ok: false, reason: '仕上げの合図を待とう' };
  st.busyUntil = Math.min(
    st.busyUntil,
    g.time + Math.max(350, Math.round((st.busyUntil - g.time) * 0.45)),
  );
  st.boosted = true;
  st.quality = true;
  return { ok: true, action: '調理を早めた', quality: true };
}

const EXCLUSIVE_STATION_KINDS = new Set(['board', 'pot', 'grill']);

function stationIdsOfKind(g, kind) {
  return activeStationIds(g).filter((id) => stationKind(id) === kind);
}

function crewIds(g) {
  return Array.isArray(g.duty) ? g.duty : Object.keys(g.crew ?? {});
}

export function handoffOption(g) {
  if (g.practice || g.time >= g.duration || !g.human.carrying) return null;
  const human = g.human;
  const partner = crewIds(g)
    .filter((id) => {
      const other = actor(g, id);
      return (
        other &&
        staffAvailable(g.staffState, id) &&
        !other.carrying &&
        Math.hypot(human.x - other.x, human.y - other.y) <= REACH
      );
    })
    .sort(
      (a, b) =>
        Math.hypot(human.x - actor(g, a).x, human.y - actor(g, a).y) -
        Math.hypot(human.x - actor(g, b).x, human.y - actor(g, b).y),
    )[0];
  if (!partner) return null;
  const item = human.carrying;
  return {
    partner,
    item,
    label: `${STAFF[partner].name.split('の').at(-1)}に${ITEM_NAMES[item]}を渡す`,
  };
}

export function handoff(g, partner) {
  const option = handoffOption(g);
  if (!option || option.partner !== partner) return { ok: false };
  const other = actor(g, partner);
  other.carrying = g.human.carrying;
  other.quality = g.human.quality;
  g.human.carrying = null;
  g.human.quality = false;
  g.human.intent = other.intent = null;
  return { ok: true, action: option.label };
}

function otherCrew(g, who, predicate) {
  return crewIds(g).some((id) => id !== who && predicate(id, actor(g, id)));
}

function stationReserved(g, stationId, who) {
  return (
    who !== 'human' &&
    EXCLUSIVE_STATION_KINDS.has(stationKind(stationId)) &&
    otherCrew(g, who, (_id, e) => e?.intent?.station === stationId)
  );
}

function actionReserved(g, actionId, who) {
  return otherCrew(g, who, (_id, e) => e?.intent?.id === actionId);
}

function canFetchTomato(g, who) {
  if (g.stock !== null && g.stock <= 0) return false;
  if (who === 'human') return true;
  const boards = stationIdsOfKind(g, 'board').filter(
    (id) => g.stations[id].state === 'idle',
  ).length;
  const incoming = [
    g.human,
    ...crewIds(g)
      .filter((id) => id !== who)
      .map((id) => actor(g, id)),
  ].filter((e) => e?.carrying === 'tomato' || e?.intent?.id === 'fetch_tomato').length;
  return boards > incoming;
}

function plateDemand(g) {
  return ['board', 'pot', 'grill'].reduce((demand, kind) => {
    const ready = stationIdsOfKind(g, kind).filter((id) =>
      (kind === 'board' ? ['chopped'] : ['cooking', 'ready']).includes(g.stations[id].state),
    ).length;
    const recipe = kind === 'board' ? 'dish' : kind === 'grill' ? 'roast' : 'soup';
    const orders = g.orders.filter((orderTicket) => orderTicket.recipe === recipe).length;
    return demand + Math.min(ready, orders);
  }, 0);
}

function plateSlotsUsed(g, who) {
  const held = [g.human, ...crewIds(g).map((id) => actor(g, id))].filter(
    (e) => e?.carrying === 'plate',
  ).length;
  const reserved = crewIds(g).filter(
    (id) => id !== who && actor(g, id)?.intent?.id === 'fetch_plate',
  ).length;
  return held + reserved;
}

function canFetchPlate(g, who) {
  return plateDemand(g) > plateSlotsUsed(g, who) && !actionReserved(g, 'fetch_plate', who);
}

export function interact(g, who, stationId) {
  syncConfig(g);
  normalizeDuty(g);
  who = resolveWho(g, who);
  const activeWho = who === 'ai' ? (g.staffId ?? g.duty[0]) : who;
  if (activeWho !== 'human' && !g.duty.includes(activeWho))
    return { ok: false, reason: 'その相棒は今シフトに入っていません' };
  const e = actor(g, who),
    st = g.stations[stationId];
  const kind = stationKind(stationId);
  if (!e) return { ok: false, reason: '担当者が見つかりません' };
  if (!st) return { ok: false, reason: 'ここでは作業できません' };
  if (!g.practice && g.time >= g.duration) return { ok: false, reason: '営業時間外です' };
  if (!activeStationIds(g).includes(stationId)) return { ok: false, reason: 'まだ準備中です' };
  if (who !== 'human' && stationReserved(g, stationId, who))
    return { ok: false, reason: '相棒がその作業台を使っています' };
  const success = (action) => ({ ok: true, action });
  const boostStation =
    (kind === 'board' && st.state === 'chopping') ||
    ((kind === 'pot' || kind === 'grill') && st.state === 'cooking');
  if (boostStation) {
    if (!e.carrying) return tryBoost(g, who, st);
  }
  switch (kind) {
    case 'crate':
      if (!e.carrying) {
        const denied = capabilityFailure(g, who, 'prep');
        if (denied) return denied;
        if (!canFetchTomato(g, who))
          return { ok: false, reason: '別の担当者がトマトを運んでいます' };
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
        if (who !== 'human' && !canFetchPlate(g, who))
          return { ok: false, reason: '今は必要なお皿がありません' };
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
        st.duration = chopDuration(g, who, stationId);
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
      e.served++;
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
  const e = actor(g, who);
  if (!e?.carrying || (!g.practice && g.time >= g.duration)) return false;
  e.carrying = null;
  e.quality = null;
  g.combo = 0;
  return true;
}

export function advance(g, elapsed = 0) {
  syncConfig(g);
  const config = levelConfig(g.level);
  normalizeDuty(g);
  g.time = g.practice
    ? g.time + Math.max(0, elapsed)
    : Math.min(g.duration, g.time + Math.max(0, elapsed));
  for (const [id, st] of Object.entries(g.stations)) {
    const kind = stationKind(id);
    if (kind === 'board') {
      if (st.state === 'chopping' && g.time >= st.busyUntil) st.state = 'chopped';
      continue;
    }
    if (kind !== 'pot' && kind !== 'grill') continue;
    if (st.state === 'cooking' && g.time >= st.busyUntil) {
      st.state = 'ready';
      const grace = burnGraceMs(g, id);
      st.burnAt = grace ? st.busyUntil + grace : 0;
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
  if (config.rushEnabled && !g.rushSpawned && g.time >= SHIFT_MS / 2) {
    g.rushSpawned = true;
    g.orders.push(order(g, g.time + Math.round((config.orderWindowMs * 4) / 3)));
  }
}

export function buildCandidates(g, who) {
  syncConfig(g);
  normalizeDuty(g);
  const id = resolveWho(g, who);
  const player = id === 'human';
  const e = actor(g, id);
  const active = activeStationIds(g);
  const boards = stationIdsOfKind(g, 'board');
  const pots = stationIdsOfKind(g, 'pot');
  const grills = stationIdsOfKind(g, 'grill');
  const out = [];
  const add = (baseId, label, station) => {
    const capability = actionCapability(baseId);
    if (capability && !canOperate(g, id, capability)) return;
    if (station && stationReserved(g, station, id)) return;
    const kind = station ? stationKind(station) : null;
    const candidateId = station && station !== kind ? `${baseId}_${station}` : baseId;
    out.push({
      id: candidateId,
      ...(candidateId === baseId ? {} : { baseId }),
      label,
      station,
    });
  };
  const needs = (recipe) => player || g.orders.some((o) => o.recipe === recipe);
  if (e && (g.practice || g.time < g.duration)) {
    if (RECIPES[e.carrying]) {
      if (g.orders.some((o) => o.recipe === e.carrying))
        add('serve', '完成した料理を配膳する', 'serve');
      else if (!player) add('discard', '注文のない料理を片づける', null);
    }
    if (e.carrying === 'chopped') {
      for (const station of pots)
        if (g.stations[station].state === 'idle' && needs('soup'))
          add('cook', `${stationName(g, station)}でスープを煮込む`, station);
      for (const station of grills)
        if (g.stations[station].state === 'idle' && needs('roast'))
          add('grill', `${stationName(g, station)}で焼く`, station);
      if (needs('dish') || (!needs('soup') && !needs('roast')))
        add('assemble', '切ったトマトをお皿に盛ってサラダにする', 'plates');
    }
    if (e.carrying === 'plate') {
      for (const station of boards)
        if (g.stations[station].state === 'chopped' && needs('dish'))
          add('plate', `${stationName(g, station)}でサラダを盛り付ける`, station);
      for (const station of pots)
        if (g.stations[station].state === 'ready' && needs('soup'))
          add('plate_soup', `${stationName(g, station)}で盛り付ける`, station);
      for (const station of grills)
        if (g.stations[station].state === 'ready' && needs('roast'))
          add('plate_roast', `${stationName(g, station)}で盛り付ける`, station);
      add('return_plate', 'お皿を戻して手を空ける', 'plates');
    }
    if (e.carrying === 'tomato') {
      for (const station of boards)
        if (g.stations[station].state === 'idle')
          add('chop', `${stationName(g, station)}で切り始める`, station);
      if (player || out.length === 0)
        add('return_tomato', 'トマトを戻して別の仕事を手伝う', 'crate');
    }
    if (!e.carrying) {
      if (
        (player || boards.some((station) => g.stations[station].state === 'idle')) &&
        canFetchTomato(g, id)
      )
        add('fetch_tomato', 'トマトを取る', 'crate');
      for (const station of boards)
        if (
          g.stations[station].state === 'chopped' &&
          (player ||
            pots.some((target) => g.stations[target].state === 'idle' && needs('soup')) ||
            grills.some((target) => g.stations[target].state === 'idle' && needs('roast')))
        )
          add('collect', `${stationName(g, station)}から材料を取る`, station);
      for (const station of pots)
        if (g.stations[station].state === 'burnt')
          add('clean_pot', `${stationName(g, station)}を片づける`, station);
      for (const station of grills)
        if (g.stations[station].state === 'burnt')
          add('clean_grill', `${stationName(g, station)}を片づける`, station);
      if (id === 'human') {
        for (const station of boards)
          if (boostAvailable(g, g.stations[station]))
            add('boost_board', `${stationName(g, station)}の仕上げを早める`, station);
        for (const station of pots)
          if (boostAvailable(g, g.stations[station]))
            add('boost_pot', `${stationName(g, station)}の仕上げを早める`, station);
        for (const station of grills)
          if (boostAvailable(g, g.stations[station]))
            add('boost_grill', `${stationName(g, station)}の仕上げを早める`, station);
      }
      if (
        player ||
        (canFetchPlate(g, id) &&
          (boards.some((station) => g.stations[station].state === 'chopped' && needs('dish')) ||
            pots.some((station) => g.stations[station].state === 'ready' && needs('soup')) ||
            grills.some((station) => g.stations[station].state === 'ready' && needs('roast'))))
      )
        add('fetch_plate', 'お皿を用意する', 'plates');
    }
    if (e.carrying && (player || out.length === 0))
      add(
        'discard',
        RECIPES[e.carrying] && !g.orders.some((o) => o.recipe === e.carrying)
          ? '注文のない料理をQで捨て、次の注文に取りかかる（コンボをリセット）'
          : '手元の物を捨てる（コンボをリセット）',
        null,
      );
    if (player) {
      for (const candidate of out) {
        const base = (candidate.baseId ?? candidate.id).replace(/^dash_/, '');
        const recipe =
          base === 'assemble' || base === 'plate' || base.startsWith('plate_board')
            ? 'dish'
            : base.startsWith('plate_soup') || base === 'cook'
              ? 'soup'
              : base.startsWith('plate_roast') || base === 'grill'
                ? 'roast'
                : null;
        if (recipe && !g.orders.some((o) => o.recipe === recipe))
          candidate.label += '【この料理は現在注文なし】';
      }
      const near = stationAt(g, 'human');
      const transfer = handoffOption(g);
      const interaction = near.inReach && out.find((c) => c.station === near.id);
      if (transfer)
        out.push({
          id: `handoff_${transfer.item}_${transfer.partner}`,
          label: `${transfer.label}（E・相手は${STAFF[transfer.partner].description}）`,
          station: null,
          partner: transfer.partner,
          item: transfer.item,
        });
      else if (interaction) add('interact', `${interaction.label}（E）`, near.id);
      for (const id of active) {
        const work = out.find((c) => c.station === id && c.id !== 'interact');
        add(
          `visit_${id}`,
          `${stationName(g, id)}をタップ：${work ? work.label : '移動のみ（現在の手元では作業できない）'}`,
          id,
        );
      }
      for (const [direction, dx, dy] of [
        ['up', 0, -1],
        ['down', 0, 1],
        ['left', -1, 0],
        ['right', 1, 0],
        ['up_left', -1, -1],
        ['up_right', 1, -1],
        ['down_left', -1, 1],
        ['down_right', 1, 1],
      ])
        out.push({
          id: `move_${direction}`,
          label: `${direction}方向へ0.25秒移動（画面基準）`,
          station: null,
          dx,
          dy,
        });
      if (g.time >= e.dashReadyAt) {
        for (const c of [...out].filter((c) => c.station || c.dx !== undefined))
          out.push({
            ...c,
            id: `dash_${c.id}`,
            label: `ダッシュして${c.label}`,
            dash: true,
            baseId: c.id,
          });
        add('dash', 'ダッシュする（移動を継続・再使用まで1.8秒）', null);
      }
      if (e.intent) add('continue', '現在の移動・作業を続ける', null);
    }
  }
  out.push({ id: 'wait', label: '今は動かず、様子を見る', station: null });
  return out;
}

// Execution and candidate generation share the same preconditions.
export function isFeasible(g, cand, who) {
  const id = resolveWho(g, who);
  return (
    !!cand &&
    buildCandidates(g, id).some(
      (candidate) =>
        candidate.id === cand.id &&
        candidate.station === cand.station &&
        candidate.partner === cand.partner &&
        candidate.item === cand.item,
    )
  );
}

export function buildQuestions(cands, who = 'ai', g) {
  const held = g?.human.carrying;
  const ordered = (recipe) => g?.orders.some((o) => o.recipe === recipe);
  const plating =
    g &&
    activeStationIds(g).filter((id) => {
      const kind = stationKind(id);
      const recipe =
        kind === 'board' ? 'dish' : kind === 'pot' ? 'soup' : kind === 'grill' ? 'roast' : null;
      return (
        recipe && ordered(recipe) && ['chopped', 'ready', 'cooking'].includes(g.stations[id].state)
      );
    });
  const plateAction = cands.find((c) => /^plate(?:_|$)/.test(c.id) && plating?.includes(c.station));
  const emptyHands = plating?.length
    ? `Ordered food at ${plating.join(', ')} needs a plate. Fetch a plate to serve it before preparing more ingredients.`
    : cands.some((c) => c.id === 'collect')
      ? 'Chopped ingredients are available. Collect them and prepare an ordered soup or roast.'
      : cands.some((c) => c.id === 'clean_pot' || c.id === 'clean_grill')
        ? 'Burnt cookware is blocking production. Clean it with your empty hands.'
        : 'No food is ready to plate. Fetch a tomato and chop it to start an order.';
  const objective = RECIPES[held]
    ? g.orders.some((o) => o.recipe === held)
      ? 'Serve your finished dish now.'
      : 'Your finished dish has NO order. Discard it now (Q) to free your hands.'
    : ({
        tomato: 'Chop your tomato at an idle board. Return it only if all boards are occupied.',
        chopped:
          'Cook or grill your chopped tomato for a visible order. Assemble salad only if a salad is ordered.',
        plate: plateAction
          ? `Ordered food is ready. Choose ${plateAction.id} or its dash_ version to plate it now. Do not return your plate.`
          : plating?.length
            ? `Ordered food is cooking at ${plating.join(', ')}. Keep your plate and wait for it; do not return the plate.`
            : 'No ordered food is ready or cooking. Return your plate to free your hands and prepare ingredients.',
      }[held] ?? emptyHands);
  return {
    next_action: {
      type: 'choice',
      instructions:
        who === 'human'
          ? `You control the HUMAN player. ${objective} Prefer a named cooking action, which walks AND works automatically; dash_ is faster. Avoid visit_/move_ with no useful work. Handoff only to a partner who can use the item. Keep selling beyond quota.`
          : 'You control the AI sous-chef. Choose one feasible action that complements the human and serves the earliest orders. Salad: tomato → chop → plate → serve. Soup: tomato → chop → collect → pot → plate → serve. Grilled tomato: tomato → chop → collect → grill → plate → serve. Clean burnt cookware before reusing it. Respect the collaboration policy, including Japanese. Keep useful raw ingredients; discard finished dishes without orders. Work ahead while food cooks.',
      criteria: Object.fromEntries(cands.map((c) => [c.id, c.label])),
    },
  };
}

function actorObservation(e) {
  return e
    ? {
        carrying: e.carrying,
        x: Math.round(e.x),
        y: Math.round(e.y),
        at_station: e.station,
        last_action: e.action,
        recent_actions: e.lastActions?.slice(-4).map((a) => a.label) ?? [],
        intent: e.intent ? { id: e.intent.id, station: e.intent.station } : null,
        quality: e.quality,
      }
    : null;
}

function staffObservation(g, id) {
  const profile = staffProfile(g, id);
  if (!profile) return null;
  return {
    id,
    name: profile.name,
    role: profile.role,
    employment: profile.employment,
    wage: profile.wage,
    max_consecutive: profile.maxConsecutive,
    rest_shifts: profile.restShifts,
    worked: g.staffState?.[id]?.worked ?? 0,
    rest: g.staffState?.[id]?.rest ?? 0,
    speed: profile.speed,
    chop: profile.chop,
    cook: profile.cook,
    capabilities: profile.capabilities,
    can_dash: profile.canDash,
    decision_interval_ms: profile.decisionMs,
  };
}

function stationObservation(g, id, active) {
  const station = g.stations[id];
  const info = active ? stationInfo(g, id) : null;
  return {
    active,
    ...(info ? { x: info.x, y: info.y, dx: info.dx, dy: info.dy } : {}),
    state: station.state ?? 'idle',
    by: station.by ?? null,
    started_at: station.startedAt ?? 0,
    duration: station.duration ?? 0,
    burn_seconds:
      station.state === 'ready' && station.burnAt
        ? Math.max(0, Math.ceil((station.burnAt - g.time) / 1000))
        : null,
  };
}

export function observe(g, policy, who) {
  syncConfig(g);
  const id = resolveWho(g, who);
  const active = new Set(activeStationIds(g));
  const crew = Object.fromEntries(
    crewIds(g).map((crewId) => [crewId, actorObservation(actor(g, crewId))]),
  );
  return {
    practice: g.practice,
    level: g.level,
    quota: g.quota,
    stock: g.stock,
    duration_seconds: Number.isFinite(g.duration) ? Math.ceil(g.duration / 1000) : null,
    cash: g.cash,
    hired: g.hired,
    duty: g.duty,
    staff_state: g.staffState,
    equipment: g.equipment,
    training: g.training,
    layout: { ...g.layout },
    kitchen_bounds: kitchenBounds(g),
    stations: Object.fromEntries(
      Object.keys(g.stations).map((stationId) => [
        stationId,
        stationObservation(g, stationId, active.has(stationId)),
      ]),
    ),
    staff: staffObservation(g, id),
    actor: actorObservation(actor(g, id)),
    crew,
    policy: policy?.trim() || null,
    human: actorObservation(g.human),
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
    quality: {
      human: g.human.quality,
      ...Object.fromEntries(
        crewIds(g).map((crewId) => [crewId, actor(g, crewId)?.quality ?? false]),
      ),
    },
    board_operator: g.stations.board.state === 'chopping' ? g.stations.board.by : null,
    orders: g.orders.map((o) => ({
      recipe: o.recipe,
      seconds_left: g.practice ? null : Math.ceil((o.deadline - g.time) / 1000),
    })),
    seconds_left: g.practice ? null : Math.ceil((g.duration - g.time) / 1000),
    orders_served: g.served,
  };
}

export function rulePick(g, cands, who) {
  const id = resolveWho(g, who);
  const leadRecipe = [...g.orders].sort((a, b) => a.deadline - b.deadline)[0]?.recipe;
  const role = staffProfile(g, id)?.role ?? 'allrounder';
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
    if (c.station && stationReserved(g, c.station, id)) return false;
    return true;
  });
  const rank = (candidate) => {
    const index = priority.indexOf(candidate.baseId ?? candidate.id);
    return index < 0 ? priority.length : index;
  };
  return [...usable].sort((a, b) => rank(a) - rank(b))[0] ?? cands.find((c) => c.id === 'wait');
}

export function actionHint(g, id) {
  const item = g.human.carrying;
  const kind = stationKind(id);
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
  if (kind === 'board') {
    const board = g.stations[id] ?? g.stations.board;
    if (board.state === 'chopping') {
      return !item && boostAvailable(g, board) ? '仕上げる' : '切り終わるまで待つ';
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
  if (kind === 'pot') {
    const pot = g.stations[id] ?? g.stations.pot;
    if (pot.state === 'cooking') {
      return !item && boostAvailable(g, pot) ? '仕上げる' : '煮込み中、別の仕事へ';
    }
    if (pot.state === 'burnt') return !item ? '焦げを片づける' : '鍋を片づけよう';
    if (pot.state === 'ready') return item === 'plate' ? 'スープを盛る' : 'お皿を持ってくる';
    if (item === 'chopped') return 'スープを煮る';
    if (RECIPES[item]) return '配膳口へ運ぶ';
    return '切ったトマトを持ってこよう';
  }
  if (kind === 'grill') {
    const grill = g.stations[id] ?? g.stations.grill;
    if (grill.state === 'cooking') {
      return !item && boostAvailable(g, grill) ? '仕上げる' : '焼き上がりを待とう';
    }
    if (grill.state === 'burnt') return !item ? '焦げを片づける' : 'グリルを片づけよう';
    if (grill.state === 'ready') return item === 'plate' ? '焼きトマトを盛る' : 'お皿を持ってくる';
    if (item === 'chopped') return 'トマトを焼く';
    return '切ったトマトを持ってこよう';
  }
  if (RECIPES[item]) {
    return g.orders.some((order) => order.recipe === item) ? '配膳する' : '注文なし：Qで片づけ';
  }
  return '完成した料理を持ってこよう';
}
