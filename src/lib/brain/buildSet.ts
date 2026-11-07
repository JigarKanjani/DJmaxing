// Entry point: room in, playable set out.

import type { BuiltSet, Room, SetEntry, Song } from "../types";
import { energyCurve } from "./energyCurve";
import { playWindow } from "./grid";
import { orderSet } from "./order";
import { planTransition } from "./planner";
import { seededRandom } from "./rng";
import { buildPool } from "./selection";

export interface BuildOptions {
  cutsOnly?: boolean;
}

export function averagePlaySeconds(songs: Song[]): number {
  if (songs.length === 0) return 75;
  const total = songs.reduce((sum, s) => {
    const w = playWindow(s);
    return sum + (w.end - w.start);
  }, 0);
  return Math.max(30, total / songs.length);
}

export function buildSet(library: Song[], room: Room, opts: BuildOptions = {}): BuiltSet {
  const random = seededRandom(room.seed ?? Date.now());
  const roughCount = Math.max(3, Math.ceil((room.minutes * 60) / averagePlaySeconds(library)));
  const pool = buildPool(library, room, roughCount);
  const count = Math.max(1, Math.min(pool.songs.length, Math.ceil((room.minutes * 60) / averagePlaySeconds(pool.songs))));
  const targets = energyCurve(count, room.moment, room.crowd);
  // Give the search more songs than slots, so it chooses which ones as well as their order.
  const candidates = pool.songs.slice(0, Math.max(count * 2, count + 20));
  const ordered = orderSet(candidates, { targets, roomLanguages: room.languages, random });

  const windows = ordered.songs.map((s) => playWindow(s));
  const entries: SetEntry[] = ordered.songs.map((song, i) => {
    const w = windows[i] ?? { start: 0, end: 60 };
    return { song, start: w.start, end: w.end, targetEnergy: targets[i] ?? 7, transition: null, score: ordered.scores[i] ?? null };
  });
  for (let i = 0; i < entries.length - 1; i++) {
    const a = entries[i];
    const b = entries[i + 1];
    if (!a || !b) continue;
    a.transition = planTransition({
      outgoing: a.song,
      outStart: a.start,
      outEnd: a.end,
      incoming: b.song,
      inEntry: b.start,
      playback: room.playback,
      cutsOnly: opts.cutsOnly,
    });
  }
  const seconds = entries.reduce((sum, e) => sum + (e.end - e.start) - (e.transition?.overlap ?? 0), 0);
  return { entries, notes: pool.notes, seconds };
}
