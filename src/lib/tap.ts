// Turning taps into a tempo and a beat grid, for the curator's tap tool.

export interface TapResult {
  bpm: number;
  /** Typical distance of a tap from the fitted grid, in milliseconds. Under ~25 ms is a steady tap. */
  jitterMs: number;
  /** Fitted time of the first tap's beat. */
  phase: number;
}

/**
 * Fits a straight line through tap times (beat number vs time). Unlike averaging the gaps,
 * a least-squares fit is not thrown off by one early or late tap, and skipping a beat is handled.
 */
export function fitTaps(times: number[]): TapResult | null {
  if (times.length < 4) return null;
  const sorted = [...times].sort((a, b) => a - b);
  // Assign beat numbers using the median gap, so a missed tap counts as two beats.
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]!);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
  if (!(median > 0.2 && median < 1.5)) return null;
  const idx: number[] = [0];
  for (let i = 1; i < sorted.length; i++) idx.push(idx[i - 1]! + Math.max(1, Math.round(gaps[i - 1]! / median)));
  const n = sorted.length;
  const mx = idx.reduce((a, b) => a + b, 0) / n;
  const my = sorted.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (idx[i]! - mx) * (sorted[i]! - my);
    sxx += (idx[i]! - mx) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = sorted.map((t, i) => t - (intercept + slope * idx[i]!));
  const rms = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n);
  return { bpm: Math.round((60 / slope) * 100) / 100, jitterMs: Math.round(rms * 1000), phase: intercept };
}

/** First downbeat normalised to the earliest bar in the song (always 0 or more). */
export function normaliseDownbeat(downbeatTime: number, bpm: number, beatsPerBar = 4): number {
  const bar = (60 / bpm) * beatsPerBar;
  const t = downbeatTime - Math.floor(downbeatTime / bar) * bar;
  return Math.round(t * 1000) / 1000;
}

/** Which beat of the bar (1 to beatsPerBar) a time falls on, and how far through that beat. */
export function beatAt(t: number, bpm: number, firstDownbeat: number, beatsPerBar = 4): { beat: number; frac: number; bar: number } {
  const beatLen = 60 / bpm;
  const k = (t - firstDownbeat) / beatLen;
  const whole = Math.floor(k);
  const beat = (((whole % beatsPerBar) + beatsPerBar) % beatsPerBar) + 1;
  return { beat, frac: k - whole, bar: Math.floor(whole / beatsPerBar) + 1 };
}
