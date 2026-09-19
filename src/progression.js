export const MAX_LEVEL = 100;

const FIRST_LEVEL = 1;
const FEATURE_LEVELS = Object.freeze({
  pot: 5,
  grill: 10,
  boost: 15,
  burning: 20,
  fatigue: 25,
  rush: 30,
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
  const soup = level >= FEATURE_LEVELS.pot ? 0.4 - 0.05 * progressBetween(level, 5, 100) : 0;
  const roast = level >= FEATURE_LEVELS.grill ? 0.2 + 0.1 * progressBetween(level, 10, 100) : 0;
  return Object.freeze({ dish: 1 - soup - roast, soup, roast });
}

function quota(level) {
  if (level <= FEATURE_LEVELS.rush) return 6 + Math.floor(level / 5);
  return 12 + Math.round(2 * Math.sqrt(progressBetween(level, 30, 100)));
}

function orderWindowMs(level) {
  if (level <= FEATURE_LEVELS.rush) {
    const featureStage = Math.min(5, Math.floor(level / 5));
    return Math.round((36 - 12 * Math.sqrt(featureStage / 5)) * 1000);
  }
  return Math.round((24 - 4 * Math.sqrt(progressBetween(level, 30, 100))) * 1000);
}

function unlockLabel(level) {
  if (level >= FEATURE_LEVELS.rush) return 'ラッシュ注文・4人稼働';
  if (level >= FEATURE_LEVELS.fatigue) return '連勤と休み';
  if (level >= FEATURE_LEVELS.burning) return '焦げ管理・3人稼働';
  if (level >= FEATURE_LEVELS.boost) return '仕上げブースト';
  if (level >= FEATURE_LEVELS.grill) return 'グリル・2人稼働';
  if (level >= FEATURE_LEVELS.pot) return 'スープ鍋';
  return 'サラダ厨房';
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
    staffSlots:
      normalized >= FEATURE_LEVELS.rush
        ? 4
        : normalized >= FEATURE_LEVELS.burning
          ? 3
          : normalized >= FEATURE_LEVELS.grill
            ? 2
            : 1,
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
