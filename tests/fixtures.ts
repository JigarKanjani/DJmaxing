import type { Song } from "../src/lib/types";

let n = 0;
export function song(p: Partial<Song> = {}): Song {
  n += 1;
  const id = p.id ?? `song-${n}`;
  return {
    id,
    title: p.title ?? `Song ${n}`,
    artist: p.artist ?? `Artist ${n}`,
    language: "hindi",
    moods: ["dance"],
    year: null,
    energy: 7,
    fame: 2,
    bpm: null,
    camelot: null,
    beatGrid: null,
    hook: { entry: 32, exit: 96 },
    vocals: null,
    loudnessLufs: null,
    durationSec: 200,
    media: { youtube: ["abcdefghijk"], file: `${id}.mp3`, spotifyUri: null },
    analysis: { source: "manual", verified: true },
    ...p,
  };
}

/** A song with a full grid at the given tempo; hook entry on a downbeat. */
export function gridSong(bpm: number, camelot: string, p: Partial<Song> = {}): Song {
  const bar = (4 * 60) / bpm;
  return song({
    bpm,
    camelot,
    beatGrid: { firstDownbeat: 0.5, beatsPerBar: 4 },
    hook: { entry: 0.5 + 16 * bar, exit: 0.5 + 48 * bar },
    ...p,
  });
}
