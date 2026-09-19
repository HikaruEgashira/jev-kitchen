export const DROP_DURATION = 0.65;
export const ENTRANCE_DURATION = 1.4 + DROP_DURATION;
export const entranceDuration = (stationCount: number, crewCount = 1): number =>
  Math.max(1.4 + Math.max(0, crewCount - 1) * 0.1, 0.7 + (stationCount - 1) * 0.1) + DROP_DURATION;

export function entranceHeight(elapsed: number, delay = 0): number {
  if (elapsed >= delay + DROP_DURATION) return 0;
  const t = Math.max(0, (elapsed - delay) / DROP_DURATION);
  if (t < 0.72) return 8 * (1 - (t / 0.72) ** 2);
  return 0.2 * Math.sin((Math.PI * (t - 0.72)) / 0.28);
}
