// Orders the set with a beam search: keeps the best few partial sets at each step instead of
// greedily taking the single best next song, so one good move does not force a bad one later.

import type { Song, TransitionScore } from "../types";
import { mainArtist, transitionScore } from "./scoring";

interface Beam {
  songs: Song[];
  scores: (TransitionScore | null)[];
  used: Set<string>;
  total: number;
}

export interface OrderOptions {
  targets: number[];
  roomLanguages: string[];
  random: () => number;
  beamWidth?: number;
  /** How many of the best next candidates each beam expands. */
  branch?: number;
}

export interface OrderedSet {
  songs: Song[];
  scores: (TransitionScore | null)[];
}

export function orderSet(pool: Song[], opts: OrderOptions): OrderedSet {
  const n = Math.min(opts.targets.length, pool.length);
  const width = opts.beamWidth ?? 12;
  const branch = opts.branch ?? 10;
  // Small random jitter per song so repeated builds of the same room differ a little.
  const jitter = new Map(pool.map((s) => [s.id, opts.random() * 0.35]));

  let beams: Beam[] = [{ songs: [], scores: [], used: new Set(), total: 0 }];
  for (let i = 0; i < n; i++) {
    const target = opts.targets[i] ?? 7;
    const next: Beam[] = [];
    for (const beam of beams) {
      const prev = beam.songs[beam.songs.length - 1] ?? null;
      const ctx = {
        recentArtists: beam.songs.slice(-5).map(mainArtist),
        recentLanguages: beam.songs.slice(-3).map((s) => s.language),
        roomLanguages: opts.roomLanguages,
      };
      const candidates: { song: Song; score: TransitionScore; value: number }[] = [];
      for (const song of pool) {
        if (beam.used.has(song.id)) continue;
        const score = transitionScore(prev, song, target, ctx);
        const value = score.total + 0.25 * song.fame + (jitter.get(song.id) ?? 0);
        candidates.push({ song, score, value });
      }
      candidates.sort((a, b) => b.value - a.value);
      for (const c of candidates.slice(0, branch)) {
        const used = new Set(beam.used);
        used.add(c.song.id);
        next.push({
          songs: [...beam.songs, c.song],
          scores: [...beam.scores, prev ? c.score : null],
          used,
          total: beam.total + c.value,
        });
      }
    }
    next.sort((a, b) => b.total - a.total);
    // Keep beams that end differently, so the search does not collapse onto one path.
    const seen = new Set<string>();
    beams = [];
    for (const b of next) {
      const key = b.songs[b.songs.length - 1]?.id + "|" + b.songs.length;
      if (seen.has(key)) continue;
      seen.add(key);
      beams.push(b);
      if (beams.length >= width) break;
    }
    if (beams.length === 0) break;
  }
  const best = beams[0];
  return best ? { songs: best.songs, scores: best.scores } : { songs: [], scores: [] };
}
