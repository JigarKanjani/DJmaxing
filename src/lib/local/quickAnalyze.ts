// Fast in-browser analysis for local files the Python analyser has not seen yet.
// It measures tempo, the first beat, loudness and length. Key, hooks and vocals need the analyser.

import { guess } from "web-audio-beat-detector";
import { songId } from "../library";
import type { Song } from "../types";

const MEDIA_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm|mp4|m4v|mov)$/i;

export function isMediaFile(name: string): boolean {
  return MEDIA_EXT.test(name);
}

/** "Artist - Title.mp3" or "01 Artist - Title.mp3" into title and artist. */
export function parseFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/^.*[\\/]/, "").replace(MEDIA_EXT, "").replace(/^\d{1,3}[\s._-]+/, "").replace(/_/g, " ").trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0]!.trim(), title: parts.slice(1).join(" - ").trim() };
  return { title: base, artist: "Unknown artist" };
}

/** Rough 1-10 energy from loudness and tempo. Marked as an estimate in the library. */
export function estimateEnergy(rmsDb: number, bpm: number | null): number {
  const loud = (rmsDb + 30) / 2.4; // about -20 dBFS RMS (loud master) maps to 4
  const pace = bpm ? (bpm >= 118 ? 2 : bpm >= 100 ? 1.2 : 0.4) : 1;
  return Math.max(1, Math.min(10, Math.round(loud + pace + 2)));
}

function rmsDb(buffer: AudioBuffer): number {
  let sum = 0;
  let n = 0;
  const ch = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / 400000));
  for (let i = 0; i < ch.length; i += step) {
    const v = ch[i] ?? 0;
    sum += v * v;
    n++;
  }
  return 10 * Math.log10(sum / Math.max(1, n) + 1e-12);
}

/** Folds a detected tempo into the 70-180 range dance floors feel. */
export function foldTempo(bpm: number): number {
  let b = bpm;
  while (b < 70) b *= 2;
  while (b > 180) b /= 2;
  return Math.round(b * 10) / 10;
}

export async function quickAnalyze(file: File, relativePath: string): Promise<Song> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  let bpm: number | null = null;
  let firstBeat: number | null = null;
  try {
    // Analyse a minute from the middle third, where the beat is usually steady.
    const offset = buffer.duration > 120 ? buffer.duration / 3 : 0;
    const length = Math.min(60, buffer.duration - offset);
    const g = await guess(buffer, offset, length);
    bpm = foldTempo(g.bpm);
    const beat = 60 / bpm;
    // g.offset is a beat time inside the analysed window; move it back to the song start.
    firstBeat = ((g.offset % beat) + beat) % beat;
  } catch {
    // Beatless or too short: leave tempo unknown.
  }
  const { title, artist } = parseFileName(relativePath);
  return {
    id: songId(title, artist),
    title,
    artist,
    language: "other",
    moods: ["party"],
    year: null,
    energy: estimateEnergy(rmsDb(buffer), bpm),
    fame: 2,
    bpm,
    camelot: null,
    beatGrid: firstBeat !== null ? { firstDownbeat: Math.round(firstBeat * 1000) / 1000, beatsPerBar: 4 } : null,
    hook: null,
    vocals: null,
    loudnessLufs: null,
    durationSec: Math.round(buffer.duration * 10) / 10,
    media: { youtube: [], file: relativePath, spotifyUri: null },
    analysis: {
      source: "estimate",
      verified: false,
      notes: "Quick browser analysis: tempo and a beat position only (may not be the bar's first beat). Run the Python analyser or tap it in the curator for hooks, key and downbeats.",
    },
  };
}
