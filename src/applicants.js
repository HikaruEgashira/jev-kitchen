/**
 * Applicant draw, shared by the live game and replay verification.
 *
 * The live game passes `Math.random`; the ranked replay passes a seeded RNG so
 * the server draws the same applicants the client showed.
 */
import { STAFF } from './staff.js';

/** Small deterministic PRNG; the same seed yields the same applicant draws. */
export function seededRandom(seed) {
  let state = (Number(seed) || 0) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawApplicants(hired, random = Math.random) {
  const pool = Object.keys(STAFF).filter(
    (id) => id !== 'helper' && id !== 'veteran' && !hired.includes(id),
  );
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  if (!hired.includes('veteran') && random() < 0.01) pool.unshift('veteran');
  const applicants = pool.slice(0, 3);
  // Offer the affordable first cook, then the reserve, without a lucky draw.
  const cook = ['chef', 'sous'].find((id) => pool.includes(id));
  if (cook && !applicants.includes(cook)) applicants[applicants.length - 1] = cook;
  return applicants;
}
