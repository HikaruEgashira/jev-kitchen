import { MAX_LEVEL, FEATURE_LEVELS } from './progression.js';

export const MAX_EQUIPMENT_LEVEL = 3;

// A fixed 90-coin saving unit keeps investment prices independent of level balancing.
// Fixed prices avoid moving the savings target whenever the player levels up.
export function investmentCost(shifts) {
  return Math.round((90 * shifts) / 5) * 5;
}

// One upgrade is deliberately modest: it saves 8% of the station's active time.
// The extra count is the larger investment because it removes station contention.
export const EQUIPMENT = Object.freeze({
  board: Object.freeze({
    name: 'まな板',
    initialCount: 1,
    maxCount: 2,
    unlockLevel: 1,
    addUnlockLevel: 2,
    upgradeUnlockLevel: 2,
    addCost: investmentCost(3),
    upgradeCosts: Object.freeze([investmentCost(1.5), investmentCost(2.5)]),
  }),
  pot: Object.freeze({
    name: 'スープ鍋',
    initialCount: 1,
    maxCount: 2,
    unlockLevel: FEATURE_LEVELS.pot,
    addUnlockLevel: 8,
    upgradeUnlockLevel: FEATURE_LEVELS.pot,
    addCost: investmentCost(5),
    upgradeCosts: Object.freeze([investmentCost(2), investmentCost(3.5)]),
  }),
  grill: Object.freeze({
    name: 'グリル',
    initialCount: 1,
    maxCount: 2,
    unlockLevel: FEATURE_LEVELS.grill,
    addUnlockLevel: 10,
    upgradeUnlockLevel: FEATURE_LEVELS.grill,
    addCost: investmentCost(6),
    upgradeCosts: Object.freeze([investmentCost(2.5), investmentCost(4)]),
  }),
  warmer: Object.freeze({
    name: '保温台',
    initialCount: 0,
    maxCount: 1,
    unlockLevel: FEATURE_LEVELS.burning,
    addUnlockLevel: FEATURE_LEVELS.burning,
    upgradeUnlockLevel: FEATURE_LEVELS.burning,
    addCost: investmentCost(6),
    upgradeCosts: Object.freeze([investmentCost(3), investmentCost(4)]),
  }),
  kitchen: Object.freeze({
    name: '厨房拡張',
    initialCount: 1,
    maxCount: 1,
    unlockLevel: 1,
    addUnlockLevel: MAX_LEVEL + 1,
    upgradeUnlockLevel: 2,
    addCost: 0,
    upgradeCosts: Object.freeze([investmentCost(8), investmentCost(12)]),
  }),
});

const EQUIPMENT_KINDS = Object.freeze(Object.keys(EQUIPMENT));
const DEFAULT_EQUIPMENT = Object.freeze(
  Object.fromEntries(
    EQUIPMENT_KINDS.map((kind) => [
      kind,
      Object.freeze({ count: EQUIPMENT[kind].initialCount, level: 1 }),
    ]),
  ),
);

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasOnlyKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function readInteger(value, fallback, min, max) {
  const numeric = typeof value === 'boolean' ? NaN : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.floor(numeric))) : fallback;
}

function freezeState(value) {
  for (const kind of EQUIPMENT_KINDS) Object.freeze(value[kind]);
  return Object.freeze(value);
}

function copyState(value) {
  return Object.fromEntries(EQUIPMENT_KINDS.map((kind) => [kind, { ...value[kind] }]));
}

function validLevel(level) {
  return validInteger(level, 1, MAX_LEVEL);
}

function meetsUnlocks(value, level) {
  if (level === undefined) return true;
  if (!validLevel(level)) return false;
  return EQUIPMENT_KINDS.every((kind) => {
    const item = EQUIPMENT[kind];
    const state = value[kind];
    if (level < item.unlockLevel && (state.count !== item.initialCount || state.level !== 1))
      return false;
    if (state.count > item.initialCount && level < item.addUnlockLevel) return false;
    if (state.count === 0 && state.level > 1) return false;
    return !(state.level > 1 && level < item.upgradeUnlockLevel);
  });
}

export function equipmentState(value) {
  const source = isRecord(value) ? value : {};
  return freezeState(
    Object.fromEntries(
      EQUIPMENT_KINDS.map((kind) => {
        const current = isRecord(source[kind]) ? source[kind] : {};
        return [
          kind,
          {
            count: readInteger(
              current.count,
              EQUIPMENT[kind].initialCount,
              EQUIPMENT[kind].initialCount,
              EQUIPMENT[kind].maxCount,
            ),
            level: readInteger(current.level, 1, 1, MAX_EQUIPMENT_LEVEL),
          },
        ];
      }),
    ),
  );
}

export function validateEquipment(value, level) {
  if (!hasOnlyKeys(value, EQUIPMENT_KINDS)) return false;
  try {
    if (
      !EQUIPMENT_KINDS.every((kind) => {
        const state = value[kind];
        const item = EQUIPMENT[kind];
        return (
          hasOnlyKeys(state, ['count', 'level']) &&
          validInteger(state.count, item.initialCount, item.maxCount) &&
          validInteger(state.level, 1, MAX_EQUIPMENT_LEVEL)
        );
      })
    )
      return false;
    return (
      meetsUnlocks(value, level) && equipmentCapacity(value).used <= equipmentCapacity(value).limit
    );
  } catch {
    return false;
  }
}

export function equipmentDurationMultiplier(equipment, kind) {
  if (!EQUIPMENT[kind] || kind === 'warmer' || kind === 'kitchen') return 1;
  const level = equipmentState(equipment)[kind].level;
  return 1 - 0.08 * (level - 1);
}

export function equipmentBurnMultiplier(equipment) {
  const warmer = equipmentState(equipment).warmer;
  if (warmer.count < 1) return 1;
  return [1, 1.5, 1.75, 2][warmer.level] ?? 1;
}

export function equipmentCapacity(equipment) {
  const state = equipmentState(equipment);
  const used = ['board', 'pot', 'grill'].reduce(
    (total, kind) => total + Math.max(0, state[kind].count - 1),
    state.warmer.count,
  );
  return Object.freeze({ used, limit: [0, 1, 2, 4][state.kitchen.level] ?? 1 });
}

export function stationKind(stationId) {
  if (typeof stationId !== 'string') return stationId;
  const match = /^(board|pot|grill)(?:2)?$/.exec(stationId);
  return match ? match[1] : stationId;
}

function quoteResult(equipment, cost, error = null) {
  return Object.freeze({ equipment, cost, error });
}

export function quoteEquipment(equipment, purchases, nextLevel) {
  const base = equipmentState(equipment);
  if (equipment !== null && equipment !== undefined && !validateEquipment(equipment))
    return quoteResult(base, 0, '設備データが不正です');
  if (!validLevel(nextLevel)) return quoteResult(base, 0, '次のレベルが不正です');
  if (!Array.isArray(purchases) || !purchases.every((purchase) => typeof purchase === 'string'))
    return quoteResult(base, 0, '設備購入リストが不正です');

  const next = copyState(base);
  let cost = 0;
  for (const purchase of purchases) {
    const match = /^(add|upgrade)_(board|pot|grill|warmer|kitchen)$/.exec(purchase);
    if (!match) return quoteResult(base, 0, `不明な設備購入です: ${purchase}`);
    const [, action, kind] = match;
    const item = EQUIPMENT[kind];
    const state = next[kind];
    if (action === 'add') {
      if (kind === 'kitchen') return quoteResult(base, 0, '厨房拡張は改良のみ購入できます');
      if (nextLevel < item.addUnlockLevel)
        return quoteResult(base, 0, `${item.name}の増設はLv${item.addUnlockLevel}からです`);
      if (state.count >= item.maxCount)
        return quoteResult(base, 0, `${item.name}はこれ以上増設できません`);
      state.count++;
      cost += item.addCost;
    } else {
      if (nextLevel < item.upgradeUnlockLevel)
        return quoteResult(base, 0, `${item.name}の強化はLv${item.upgradeUnlockLevel}からです`);
      if (state.count < 1) return quoteResult(base, 0, `${item.name}を先に導入してください`);
      if (state.level >= MAX_EQUIPMENT_LEVEL)
        return quoteResult(base, 0, `${item.name}はこれ以上強化できません`);
      cost += item.upgradeCosts[state.level - 1];
      state.level++;
    }
  }
  const capacity = equipmentCapacity(next);
  if (capacity.used > capacity.limit) return quoteResult(base, 0, '厨房の設備枠が足りません');
  return quoteResult(freezeState(next), cost);
}

export { DEFAULT_EQUIPMENT };
