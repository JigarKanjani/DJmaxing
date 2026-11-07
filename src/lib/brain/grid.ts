// Beat grid maths. All times are seconds in a song's own media timeline.

import type { Song } from "../types";

export const BARS_PER_PHRASE = 8;

export function beatSeconds(bpm: number): number {
  return 60 / bpm;
}

export function barSeconds(bpm: number, beatsPerBar = 4): number {
  return beatSeconds(bpm) * beatsPerBar;
}

/** True when the song has enough data to place bars and phrases. */
export function hasGrid(song: Song): song is Song & { bpm: number; beatGrid: NonNullable<Song["beatGrid"]> } {
  return typeof song.bpm === "number" && song.bpm > 0 && !!song.beatGrid && Number.isFinite(song.beatGrid.firstDownbeat);
}

/** Snaps a time to the bar grid. Without a grid, returns the time unchanged. */
export function snapToBar(song: Song, t: number, mode: "nearest" | "floor" | "ceil" = "nearest"): number {
  if (!hasGrid(song)) return t;
  const bar = barSeconds(song.bpm, song.beatGrid.beatsPerBar);
  const k = (t - song.beatGrid.firstDownbeat) / bar;
  const n = mode === "floor" ? Math.floor(k + 1e-6) : mode === "ceil" ? Math.ceil(k - 1e-6) : Math.round(k);
  return Math.max(0, song.beatGrid.firstDownbeat + n * bar);
}

/**
 * The latest phrase boundary at or before `limit`, counting phrases from `start`.
 * Hooks start on a phrase, so phrases are counted from the hook entry.
 * Falls back to whole bars when the window is shorter than one phrase.
 */
export function phraseEndBefore(song: Song, start: number, limit: number): number {
  if (!hasGrid(song)) return limit;
  const bar = barSeconds(song.bpm, song.beatGrid.beatsPerBar);
  const phrase = bar * BARS_PER_PHRASE;
  const phrases = Math.floor((limit - start) / phrase + 1e-6);
  if (phrases >= 1) return start + phrases * phrase;
  const bars = Math.floor((limit - start) / bar + 1e-6);
  return bars >= 1 ? start + bars * bar : limit;
}

/** Default start when a song has not been timed yet. */
export function untimedStart(song: Song): number {
  const d = song.durationSec ?? 0;
  return d > 0 ? Math.min(30, Math.round(d * 0.2)) : 30;
}

/** Where a song should start and stop in a set, snapped to its grid. */
export function playWindow(song: Song, fallbackLength = 75): { start: number; end: number } {
  const duration = song.durationSec && song.durationSec > 0 ? song.durationSec : null;
  const rawStart = song.hook ? song.hook.entry : untimedStart(song);
  const start = snapToBar(song, rawStart, "nearest");
  const hardEnd = duration ? duration - 1.5 : Number.POSITIVE_INFINITY;
  let rawEnd: number;
  if (song.hook && song.hook.exit !== null) rawEnd = song.hook.exit;
  else if (song.hook && song.hook.exit === null) rawEnd = duration ? duration - 1.5 : start + 240;
  else rawEnd = start + fallbackLength;
  rawEnd = Math.min(rawEnd, hardEnd);
  let end = phraseEndBefore(song, start, rawEnd);
  const MIN_PLAY = 20;
  if (end - start < MIN_PLAY) {
    if (hasGrid(song)) {
      // Too short to feel like a song: extend by whole phrases (or bars) so the handover stays on a phrase end.
      const bar = barSeconds(song.bpm, song.beatGrid.beatsPerBar);
      const phrase = bar * BARS_PER_PHRASE;
      const byPhrase = start + Math.ceil(MIN_PLAY / phrase) * phrase;
      end = byPhrase <= hardEnd ? byPhrase : start + Math.floor((hardEnd - start) / bar) * bar;
    } else {
      end = Math.min(hardEnd, start + MIN_PLAY);
    }
  }
  return { start, end };
}
