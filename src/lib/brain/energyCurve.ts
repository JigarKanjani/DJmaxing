// The shape of the night: target energy (1-10) for each slot in the set.

import type { Crowd, Moment } from "../types";

const CROWD_SHIFT: Record<Crowd, number> = { small: -0.7, medium: 0, large: 0.5 };

function clamp(v: number, lo = 1, hi = 10): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Target energy for slot `i` of `n`.
 * - warmup: builds steadily so people arrive into rising energy.
 * - peak: climbs for the first quarter, then rides waves (three or four big songs, one breather).
 * - bangers: stays near the top with small dips so it never feels flat.
 * - winddown: eases off towards singalongs and slower songs.
 */
export function targetEnergy(i: number, n: number, moment: Moment, crowd: Crowd): number {
  const p = n <= 1 ? 0 : i / (n - 1);
  const shift = CROWD_SHIFT[crowd];
  switch (moment) {
    case "warmup":
      return clamp(4 + 2.5 * p + shift);
    case "peak": {
      if (p < 0.25) return clamp(6.5 + (p / 0.25) * 1.3 + shift);
      return clamp(7.8 + 1.1 * Math.sin((2 * Math.PI * i) / 5) + shift, 1, 9.6);
    }
    case "bangers":
      return clamp(8.9 + 0.6 * Math.sin((2 * Math.PI * i) / 4) + shift * 0.5, 7.5, 10);
    case "winddown":
      return clamp(6 - 2.5 * p + shift * 0.5);
  }
}

export function energyCurve(n: number, moment: Moment, crowd: Crowd): number[] {
  return Array.from({ length: n }, (_, i) => targetEnergy(i, n, moment, crowd));
}
