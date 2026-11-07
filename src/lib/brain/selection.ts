// Which songs are allowed in the room, and how well each fits.

import { SLOW_MOODS, type Mood, type Room, type Song } from "../types";

export function isSlow(song: Song): boolean {
  return song.moods.length > 0 && song.moods.every((m) => SLOW_MOODS.has(m));
}

export function hasMedia(song: Song, playback: Room["playback"]): boolean {
  return playback === "youtube" ? song.media.youtube.length > 0 : !!song.media.file;
}

function roomWantsSlow(room: Room): boolean {
  return room.moment === "winddown" || room.moods.some((m) => SLOW_MOODS.has(m));
}

/** Language and mood fit, plus fame. Null when the song does not belong in this room at all. */
export function fitScore(song: Song, room: Room, allowOtherLanguages = false): number | null {
  if (!hasMedia(song, room.playback)) return null;
  const langMatch = room.languages.length === 0 || room.languages.includes(song.language);
  if (!langMatch && !allowOtherLanguages) return null;
  if (isSlow(song) && !roomWantsSlow(room)) return null;
  if (room.moment === "bangers" && song.energy < 7) return null;

  let score = langMatch ? 10 : 0;
  if (room.moods.length > 0) {
    const hit = song.moods.some((m) => room.moods.includes(m));
    if (hit) score += 6;
    else if (!isSlow(song)) score += 1;
    else return null;
  } else if (!isSlow(song)) {
    score += 3;
  }
  score += 2 * song.fame;
  return score;
}

export interface Pool {
  songs: Song[];
  fillers: Set<string>;
  notes: string[];
}

const MOOD_LABEL: Partial<Record<Mood, string>> = { hiphop: "hip-hop", edm: "EDM" };

/**
 * Picks the candidate songs for a set. If the room's languages and moods do not have enough
 * songs, it tops up with well-known songs from other languages that fit the mood, and says so.
 */
export function buildPool(library: Song[], room: Room, needed: number): Pool {
  const scored = library
    .map((song) => ({ song, score: fitScore(song, room) }))
    .filter((x): x is { song: Song; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score);
  const songs = scored.map((x) => x.song);
  const fillers = new Set<string>();
  const notes: string[] = [];

  if (songs.length < needed) {
    const have = new Set(songs.map((s) => s.id));
    const extra = library
      .filter((s) => !have.has(s.id) && s.fame >= 2)
      .map((song) => ({ song, score: fitScore(song, room, true) }))
      .filter((x): x is { song: Song; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, needed - songs.length)
      .map((x) => x.song);
    for (const s of extra) fillers.add(s.id);
    if (extra.length > 0) {
      const moodText = room.moods.length ? room.moods.map((m) => MOOD_LABEL[m] ?? m).join(" and ") + " " : "";
      notes.push(
        `Only ${songs.length} ${moodText}songs match the languages you picked, so ${extra.length} well-known songs from other languages were added.`,
      );
    }
    songs.push(...extra);
  }
  if (songs.length < needed) {
    notes.push(`The library has ${songs.length} songs for this room, so the set is shorter than asked. Add songs in the Library screen.`);
  }
  return { songs, fillers, notes };
}
