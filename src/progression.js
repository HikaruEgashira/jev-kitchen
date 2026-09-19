export const MAX_LEVEL = 100;

const FIRST_LEVEL = 1;
export const FEATURE_LEVELS = Object.freeze({
  pot: 3,
  grill: 7,
  boost: 6,
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
  if (level >= 11 && level <= 30) {
    const [dish, soup, roast] = [
      [0.6, 0.25, 0.15],
      [0.3, 0.55, 0.15],
      [0.35, 0.2, 0.45],
      [0.4, 0.35, 0.25],
      [0.5, 0.25, 0.25],
    ][(level - 11) % 5];
    return Object.freeze({ dish, soup, roast });
  }
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
  if (level === 2) return 7;
  if (level <= 4 || level === 7) return 6;
  if (level === 5) return 7;
  if (level === 6) return 6;
  if (level <= 9) return 8;
  if (level <= 30) {
    const daily = level >= 11 ? [1, -1, -1, 0, 0][(level - 11) % 5] : 0;
    return 8 + Math.floor((level - 10) / 5) + daily;
  }
  return 13 + Math.round(3 * Math.sqrt(progressBetween(level, 30, MAX_LEVEL)));
}

function orderWindowMs(level) {
  if (level === 1) return Infinity;
  if (level <= 7) return 36_000;
  if (level <= 30) return Math.round((36 - 4 * progressBetween(level, 7, 30)) * 1000);
  return Math.round((32 - 12 * Math.sqrt(progressBetween(level, 30, MAX_LEVEL))) * 1000);
}

function unlockLabel(level) {
  if (level >= 11 && level <= 30)
    return ['サラダランチ', 'スープの日', 'グリルの日', 'ミックス営業', '週末ラッシュ'][
      (level - 11) % 5
    ];
  if (level >= 16) return 'にぎわう厨房';
  if (level >= 12) return 'いつもの仲間と';
  if (level >= FEATURE_LEVELS.rush) return 'ランチのピーク';
  if (level >= FEATURE_LEVELS.fatigue) return 'ひと息つきながら';
  if (level >= 8) return '相棒が増えました';
  if (level >= FEATURE_LEVELS.grill) return 'グリルの香り';
  if (level >= FEATURE_LEVELS.burning) return '仕上げのひと手間';
  if (level === 5) return 'なじみの厨房';
  if (level === 4) return 'ハルとふたりで';
  if (level >= FEATURE_LEVELS.pot) return '店長のスープ';
  if (level === 2) return '店長と初めての営業';
  return 'はじめてのひと皿';
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
    recipeMix: recipeMix(normalized === 5 ? 4 : normalized),
    partner: normalized === 2 || normalized === 3 ? 'veteran' : null,
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
