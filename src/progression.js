export const MAX_LEVEL = 100;

const FIRST_LEVEL = 1;
export const FEATURE_LEVELS = Object.freeze({
  pot: 4,
  grill: 7,
  boost: 5,
  burning: 6,
  fatigue: 9,
  rush: 10,
});

function clampLevel(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(MAX_LEVEL, Math.max(FIRST_LEVEL, Math.floor(numeric)))
    : FIRST_LEVEL;
}

function progressBetween(level, start, end) {
  return Math.min(1, Math.max(0, (level - start) / (end - start)));
}

function recipeMix(level) {
  const soup =
    level >= FEATURE_LEVELS.pot
      ? 0.4 - 0.05 * progressBetween(level, FEATURE_LEVELS.pot, MAX_LEVEL)
      : 0;
  const roast =
    level >= FEATURE_LEVELS.grill
      ? 0.2 + 0.1 * progressBetween(level, FEATURE_LEVELS.grill, MAX_LEVEL)
      : 0;
  return Object.freeze({ dish: 1 - soup - roast, soup, roast });
}

function quota(level) {
  if (level === 1) return 1;
  if (level <= 7) return 9;
  if (level <= 10) return 11;
  return 11 + Math.round(5 * Math.sqrt(progressBetween(level, 10, MAX_LEVEL)));
}

function orderWindowMs(level) {
  if (level === 1) return Infinity;
  if (level <= 3) return 30_000;
  if (level <= 7) return 28_000;
  return Math.round((28 - 8 * Math.sqrt(progressBetween(level, 7, MAX_LEVEL))) * 1000);
}

function unlockLabel(level) {
  if (level >= 16) return '4人で連携';
  if (level >= 12) return '3人で分担';
  if (level >= FEATURE_LEVELS.rush) return 'ラッシュ注文';
  if (level >= FEATURE_LEVELS.fatigue) return '連勤と休み';
  if (level >= 8) return '店長復帰・2人稼働';
  if (level >= FEATURE_LEVELS.grill) return 'グリルと鍋を並行';
  if (level >= FEATURE_LEVELS.burning) return '焦げる前に回収';
  if (level >= FEATURE_LEVELS.boost) return '仕上げブースト';
  if (level >= FEATURE_LEVELS.pot) return 'スープはあなたの担当';
  if (level === 3) return 'ハルと役割分担';
  if (level === 2) return '店長と初めての営業';
  return '時間無制限で一皿';
}

export function levelConfig(level = FIRST_LEVEL) {
  const normalized = clampLevel(level);
  const difficulty = progressBetween(normalized, FEATURE_LEVELS.rush, MAX_LEVEL);
  return Object.freeze({
    level: normalized,
    kitchenTier: normalized >= FEATURE_LEVELS.grill ? 3 : normalized >= FEATURE_LEVELS.pot ? 2 : 1,
    // Keep the existing Lv2 save contract; finite stock does not imply a new station.
    stockFinite: normalized >= 2,
    quota: quota(normalized),
    orderWindowMs: orderWindowMs(normalized),
    recipeMix: recipeMix(normalized),
    partner: normalized === 2 ? 'veteran' : normalized === 3 ? 'helper' : null,
    staffSlots:
      normalized === 1 ? 0 : normalized >= 16 ? 4 : normalized >= 12 ? 3 : normalized >= 8 ? 2 : 1,
    boostEnabled: normalized >= FEATURE_LEVELS.boost,
    burningEnabled: normalized >= FEATURE_LEVELS.burning,
    fatigueEnabled: normalized >= FEATURE_LEVELS.fatigue,
    rushEnabled: normalized >= FEATURE_LEVELS.rush,
    difficulty,
    unlockLabel: unlockLabel(normalized),
  });
}

export function quotaForLevel(level) {
  return levelConfig(level).quota;
}
