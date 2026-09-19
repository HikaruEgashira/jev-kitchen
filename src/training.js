import { investmentCost } from './equipment.js';

// Vitamins are consumable per-actor upgrades, like a Pokémon stat item: buy one,
// pick exactly one actor (the player or any hired staff), and raise one base
// ability for the rest of the campaign. Levels persist in the checkpoint.
export const MAX_TRAINING = 5;
export const TRAINING_STEP = 0.04;

export const VITAMINS = Object.freeze({
  move: Object.freeze({
    name: 'タウリン',
    icon: '💨',
    ability: '足の速さ',
    effect: `移動 +${Math.round(TRAINING_STEP * 100)}%`,
    cost: investmentCost(0.5),
  }),
  cook: Object.freeze({
    name: 'インドメタシン',
    icon: '🔪',
    ability: '料理の速さ',
    effect: `調理 -${Math.round(TRAINING_STEP * 100)}%`,
    cost: investmentCost(0.5),
  }),
});

export const VITAMIN_IDS = Object.freeze(Object.keys(VITAMINS));

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function clampLevel(value) {
  const numeric = typeof value === 'boolean' ? NaN : Number(value);
  return Number.isFinite(numeric) ? Math.min(MAX_TRAINING, Math.max(0, Math.floor(numeric))) : 0;
}

// Missing actors read as level 0, so a newly hired actor needs no seed entry.
export function trainingLevel(training, who, item) {
  return clampLevel(training?.[who]?.[item]);
}

export function trainingState(value) {
  if (!isRecord(value)) return Object.freeze({});
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .filter(([id, entry]) => typeof id === 'string' && id && isRecord(entry))
        .map(([id, entry]) => [
          id,
          Object.freeze({ move: clampLevel(entry.move), cook: clampLevel(entry.cook) }),
        ]),
    ),
  );
}

// Checkpoints are user-editable, so only known actors and known abilities pass.
export function validateTraining(value, hired) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;
  const allowed = new Set(['human', ...(Array.isArray(hired) ? hired : [])]);
  const result = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!allowed.has(id) || !isRecord(entry)) return null;
    const keys = Object.keys(entry);
    if (
      keys.length !== 2 ||
      !keys.includes('move') ||
      !keys.includes('cook') ||
      !Number.isSafeInteger(entry.move) ||
      entry.move < 0 ||
      entry.move > MAX_TRAINING ||
      !Number.isSafeInteger(entry.cook) ||
      entry.cook < 0 ||
      entry.cook > MAX_TRAINING
    )
      return null;
    result[id] = { move: entry.move, cook: entry.cook };
  }
  return result;
}

// Move vitamins scale the actor's step up; cook vitamins scale duration down.
export function trainingMultiplier(training, who, item) {
  const level = trainingLevel(training, who, item);
  return item === 'move' ? 1 + TRAINING_STEP * level : 1 - TRAINING_STEP * level;
}

function freezeResult(training, cost, error = null) {
  return Object.freeze({ training, cost, error });
}

// Applies pending vitamins atomically; `targets` are the legal actor ids.
export function quoteVitamins(training, purchases, targets) {
  const base = trainingState(training);
  const allowed = new Set(Array.isArray(targets) ? targets : []);
  if (!Array.isArray(purchases) || !purchases.every((purchase) => isRecord(purchase)))
    return freezeResult(base, 0, '育成の購入リストが不正です');
  const next = Object.fromEntries(Object.entries(base).map(([id, entry]) => [id, { ...entry }]));
  let cost = 0;
  for (const purchase of purchases) {
    const { item, target } = purchase;
    if (!Object.hasOwn(VITAMINS, item))
      return freezeResult(base, 0, `不明な育成アイテムです: ${item}`);
    if (!allowed.has(target)) return freezeResult(base, 0, '育成の対象者が不正です');
    const entry = next[target] ?? { move: 0, cook: 0 };
    if (entry[item] >= MAX_TRAINING)
      return freezeResult(base, 0, `${VITAMINS[item].name}はこれ以上使えません`);
    entry[item] += 1;
    next[target] = entry;
    cost += VITAMINS[item].cost;
  }
  return freezeResult(
    Object.freeze(
      Object.fromEntries(
        Object.entries(next).map(([id, entry]) => [id, Object.freeze({ ...entry })]),
      ),
    ),
    cost,
  );
}
