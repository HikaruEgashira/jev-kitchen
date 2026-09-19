import { MAX_LEVEL, FEATURE_LEVELS } from './progression.ts';
import type { EquipmentCount, EquipmentItem, EquipmentState } from './types.ts';

export const MAX_EQUIPMENT_LEVEL = 3;

// A fixed 90-coin saving unit keeps investment prices independent of level balancing.
// Fixed prices avoid moving the savings target whenever the player levels up.
export function investmentCost(shifts: number): number {
  return Math.round((90 * shifts) / 5) * 5;
}

// One upgrade is deliberately modest: it saves 8% of the station's active time.
// The extra count is the larger investment because it removes station contention.
export const EQUIPMENT: Record<string, EquipmentItem> = Object.freeze({
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
const DEFAULT_EQUIPMENT: EquipmentState = Object.freeze(
  Object.fromEntries(
    EQUIPMENT_KINDS.map((kind) => [
      kind,
      Object.freeze({ count: EQUIPMENT[kind].initialCount, level: 1 }),
    ]),
  ) as EquipmentState,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    isRecord(value) &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'boolean' ? NaN : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.floor(numeric))) : fallback;
}

function freezeState(value: EquipmentState): EquipmentState {
  for (const kind of EQUIPMENT_KINDS) Object.freeze(value[kind]);
  return Object.freeze(value);
}

function copyState(value: EquipmentState): EquipmentState {
  return Object.fromEntries(EQUIPMENT_KINDS.map((kind) => [kind, { ...value[kind] }]));
}

function validLevel(level: unknown): level is number {
  return validInteger(level, 1, MAX_LEVEL);
}

function meetsUnlocks(value: EquipmentState, level: number | undefined): boolean {
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

export function equipmentState(value: unknown): EquipmentState {
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
    ) as EquipmentState,
  );
}

export function validateEquipment(value: unknown, level?: number): boolean {
  if (!hasOnlyKeys(value, EQUIPMENT_KINDS)) return false;
  const record = value as Record<string, unknown>;
  try {
    if (
      !EQUIPMENT_KINDS.every((kind) => {
        const state = record[kind];
        const item = EQUIPMENT[kind];
        return (
          hasOnlyKeys(state, ['count', 'level']) &&
          validInteger((state as EquipmentCount).count, item.initialCount, item.maxCount) &&
          validInteger((state as EquipmentCount).level, 1, MAX_EQUIPMENT_LEVEL)
        );
      })
    )
      return false;
    return (
      meetsUnlocks(record as EquipmentState, level) &&
      equipmentCapacity(record).used <= equipmentCapacity(record).limit
    );
  } catch {
    return false;
  }
}

export function equipmentDurationMultiplier(equipment: unknown, kind: string): number {
  if (!EQUIPMENT[kind] || kind === 'warmer' || kind === 'kitchen') return 1;
  const level = equipmentState(equipment)[kind].level;
  return 1 - 0.08 * (level - 1);
}

export function equipmentBurnMultiplier(equipment: unknown): number {
  const warmer = equipmentState(equipment).warmer;
  if (warmer.count < 1) return 1;
  return [1, 1.5, 1.75, 2][warmer.level] ?? 1;
}

export function equipmentCapacity(equipment: unknown): { used: number; limit: number } {
  const state = equipmentState(equipment);
  const used = ['board', 'pot', 'grill'].reduce(
    (total, kind) => total + Math.max(0, state[kind].count - 1),
    state.warmer.count,
  );
  return Object.freeze({ used, limit: [0, 1, 2, 4][state.kitchen.level] ?? 1 });
}

export function stationKind(stationId: string): string {
  const match = /^(board|pot|grill)(?:2)?$/.exec(stationId);
  return match ? match[1] : stationId;
}

function quoteResult(
  equipment: EquipmentState,
  cost: number,
  error: string | null = null,
): { equipment: EquipmentState; cost: number; error: string | null } {
  return Object.freeze({ equipment, cost, error });
}

export function quoteEquipment(equipment: unknown, purchases: unknown, nextLevel: number) {
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
    const action = match[1];
    const kind = match[2];
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
