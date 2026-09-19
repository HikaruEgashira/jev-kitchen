export const DROP_DURATION = 0.65;
export const ENTRANCE_DURATION = 1.4 + DROP_DURATION;

export function entranceHeight(elapsed, delay = 0) {
  if (elapsed >= delay + DROP_DURATION) return 0;
  const t = Math.max(0, (elapsed - delay) / DROP_DURATION);
  if (t < 0.72) return 8 * (1 - (t / 0.72) ** 2);
  return 0.2 * Math.sin((Math.PI * (t - 0.72)) / 0.28);
}
