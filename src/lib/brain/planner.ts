// Plans each handover between two songs: what kind of transition, and exactly when.

import type { Room, Song, TransitionPlan } from "../types";
import { keyCompatibility } from "./camelot";
import { barSeconds, hasGrid } from "./grid";
import { tempoMatch } from "./scoring";

/**
 * Two songs whose tempos differ drift apart while they overlap. Keep that drift under 40 ms,
 * which is roughly where a listener starts to hear two kicks (a "flam") instead of one.
 */
export const MAX_DRIFT_SECONDS = 0.04;

/** Overlapping vocals sound like a mess, so blends avoid them. */
export function vocalsOverlap(regions: Array<[number, number]> | null | undefined, from: number, to: number): boolean {
  if (!regions) return false;
  return regions.some(([a, b]) => a < to - 0.25 && b > from + 0.25);
}

export interface PlanInput {
  outgoing: Song;
  /** Where the outgoing song ends (already phrase-snapped). */
  outEnd: number;
  /** Where the outgoing song started, to stop a blend eating the whole song. */
  outStart: number;
  incoming: Song;
  /** The incoming song's hook entry (already bar-snapped). */
  inEntry: number;
  playback: Room["playback"];
  /** iPhone and iPad ignore volume changes on embedded players, so only cuts work there. */
  cutsOnly?: boolean;
}

export function planTransition(p: PlanInput): TransitionPlan {
  const { outgoing: a, incoming: b } = p;
  const cutPlan = (why: string): TransitionPlan => ({
    kind: "cut",
    outAt: p.outEnd,
    inFrom: p.inEntry,
    inAlign: p.inEntry,
    overlap: 0,
    rate: 1,
    why,
  });

  if (p.cutsOnly) return cutPlan("Cut on the downbeat (this device cannot fade embedded video).");

  if (!hasGrid(a) || !hasGrid(b)) {
    const overlap = p.playback === "local" ? 3 : 1.5;
    return {
      kind: "fade",
      outAt: p.outEnd,
      inFrom: p.inEntry,
      inAlign: p.inEntry + overlap,
      overlap,
      rate: 1,
      why: "Short fade: tempo or beat grid not measured yet for one of these songs.",
    };
  }

  const tempo = tempoMatch(a.bpm, b.bpm);
  const key = keyCompatibility(a.camelot, b.camelot);
  const diff = tempo.diff ?? 1;
  const barB = barSeconds(b.bpm, b.beatGrid.beatsPerBar);

  if (key < 0.5) return cutPlan(`Cut on the downbeat: keys ${a.camelot ?? "?"} and ${b.camelot ?? "?"} would clash if layered.`);

  let bars: number;
  let rate: number;
  if (p.playback === "local") {
    // Local files are time-stretched to the outgoing tempo, so long blends stay locked.
    if (diff > 0.08) return cutPlan(`Cut on the downbeat: ${Math.round(diff * 100)}% tempo gap is too big to stretch cleanly.`);
    rate = tempo.rate;
    bars = 8;
  } else {
    // YouTube cannot change tempo, so the blend is only as long as the drift allows.
    rate = 1;
    const fits = [4, 2, 1].find((n) => n * barB * diff <= MAX_DRIFT_SECONDS);
    if (!fits) return cutPlan(`Cut on the downbeat: ${(diff * 100).toFixed(1)}% tempo gap would flam in a blend.`);
    bars = fits;
  }

  // The incoming build-up plays under the outgoing phrase end, so its hook lands exactly on the handover.
  // Preroll is measured in the incoming song's own timeline, where one bar is barB long.
  const maxByPreroll = Math.floor(p.inEntry / barB + 1e-6);
  const outLen = p.outEnd - p.outStart;
  const maxByOutgoing = Math.floor((outLen * 0.5) / (barB / rate) + 1e-6);
  bars = Math.min(bars, maxByPreroll, maxByOutgoing);
  if (bars < 1) return cutPlan("Cut on the downbeat: no room before the incoming hook for a blend.");

  const overlap = (bars * barB) / rate; // wall-clock seconds
  const inFrom = p.inEntry - overlap * rate;
  if (vocalsOverlap(a.vocals, p.outEnd - overlap, p.outEnd) && vocalsOverlap(b.vocals, inFrom, p.inEntry)) {
    return cutPlan("Cut on the downbeat: both songs have vocals in the blend window.");
  }
  const keyText = key >= 0.85 ? "keys match" : "keys are compatible";
  const tempoText = diff <= 0.005 ? "same tempo" : p.playback === "local" ? `stretched ${((rate - 1) * 100).toFixed(1)}%` : `${(diff * 100).toFixed(1)}% tempo gap`;
  return {
    kind: "blend",
    outAt: p.outEnd,
    inFrom,
    inAlign: p.inEntry,
    overlap,
    rate,
    why: `${bars}-bar blend, ${keyText}, ${tempoText}. The hook lands on the handover.`,
  };
}
