// How well one song follows another.

import type { Song, TransitionScore } from "../types";
import { keyCompatibility } from "./camelot";

export interface TempoMatch {
  /** 0 to 1. Unknown tempo scores a neutral 0.5. */
  score: number;
  /** Relative tempo difference after half/double-time folding, e.g. 0.02 = 2%. Null when unknown. */
  diff: number | null;
  /**
   * Playback rate to apply to the incoming song so its beats line up with the outgoing song.
   * Already accounts for half or double time. 1 when unknown.
   */
  rate: number;
}

/**
 * Compares tempos the way a DJ hears them: 85 BPM and 170 BPM share a pulse,
 * so the incoming tempo is folded by 2x or 0.5x before measuring the gap.
 */
export function tempoMatch(outgoingBpm: number | null | undefined, incomingBpm: number | null | undefined): TempoMatch {
  if (!outgoingBpm || !incomingBpm || outgoingBpm <= 0 || incomingBpm <= 0) return { score: 0.5, diff: null, rate: 1 };
  let best = { mult: 1, diff: Number.POSITIVE_INFINITY };
  for (const mult of [1, 2, 0.5]) {
    const diff = Math.abs((incomingBpm * mult) / outgoingBpm - 1);
    if (diff < best.diff) best = { mult, diff };
  }
  const d = best.diff;
  // Within 2% is effectively the same tempo; past 12% only a cut works.
  const score = d <= 0.02 ? 1 : d <= 0.06 ? 1 - ((d - 0.02) / 0.04) * 0.6 : d <= 0.12 ? 0.4 - ((d - 0.06) / 0.06) * 0.4 : 0;
  return { score, diff: d, rate: outgoingBpm / (incomingBpm * best.mult) };
}

/** 1 when the song's energy hits the slot's target, falling to 0 five points away. */
export function energyFit(energy: number, target: number): number {
  return Math.max(0, 1 - Math.abs(energy - target) / 5);
}

export function mainArtist(song: Song): string {
  return (song.artist.split(/,|&|\bft\.?|\bfeat\.?|\bx\b/i)[0] ?? song.artist).trim().toLowerCase();
}

export interface VarietyContext {
  /** Main artists of the last few songs, most recent last. */
  recentArtists: string[];
  /** Languages of the last few songs, most recent last. */
  recentLanguages: string[];
  /** Languages the room asked for. Others are fillers and should be spread out. */
  roomLanguages: string[];
}

/** Penalises repeating an artist and bunching filler-language songs together. */
export function varietyScore(song: Song, ctx: VarietyContext): number {
  const artist = mainArtist(song);
  const lastTwo = ctx.recentArtists.slice(-2);
  if (lastTwo.includes(artist)) return 0;
  let score = ctx.recentArtists.slice(-5).includes(artist) ? 0.6 : 1;
  const isFiller = !ctx.roomLanguages.includes(song.language);
  if (isFiller) {
    const recentFillers = ctx.recentLanguages.slice(-2).filter((l) => !ctx.roomLanguages.includes(l)).length;
    if (recentFillers > 0) score *= 0.3;
  }
  return score;
}

export const WEIGHTS = { energy: 2.0, tempo: 1.2, key: 1.0, variety: 1.4 } as const;

export function transitionScore(prev: Song | null, next: Song, targetEnergy: number, ctx: VarietyContext): TransitionScore {
  const tempo = prev ? tempoMatch(prev.bpm, next.bpm).score : 0.5;
  const key = prev ? keyCompatibility(prev.camelot, next.camelot) : 0.5;
  const energy = energyFit(next.energy, targetEnergy);
  const variety = varietyScore(next, ctx);
  const total = WEIGHTS.energy * energy + WEIGHTS.tempo * tempo + WEIGHTS.key * key + WEIGHTS.variety * variety;
  return { total, tempo, key, energy, variety };
}
