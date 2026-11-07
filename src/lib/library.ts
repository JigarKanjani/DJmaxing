// Loading, validating, merging and saving the song library.

import { parseCamelot } from "./brain/camelot";
import { LANGUAGES, MOODS, type Library, type Song } from "./types";

const STORAGE_KEY = "djmaxing.library.v1";
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function songId(title: string, artist: string): string {
  const main = artist.split(/,|&|\bft\.?|\bfeat\.?/i)[0] ?? artist;
  return slugify(`${title} ${main}`);
}

/** Returns a list of problems; an empty list means the song is valid. */
export function validateSong(s: unknown): string[] {
  const errors: string[] = [];
  if (typeof s !== "object" || s === null) return ["not an object"];
  const song = s as Partial<Song>;
  const where = typeof song.id === "string" ? song.id : "(no id)";
  const err = (m: string) => errors.push(`${where}: ${m}`);
  if (typeof song.id !== "string" || !/^[a-z0-9-]+$/.test(song.id)) err("id must be a lowercase slug");
  if (typeof song.title !== "string" || !song.title.trim()) err("title is required");
  if (typeof song.artist !== "string" || !song.artist.trim()) err("artist is required");
  if (!LANGUAGES.includes(song.language as never)) err(`language must be one of ${LANGUAGES.join(", ")}`);
  if (!Array.isArray(song.moods) || song.moods.length === 0 || !song.moods.every((m) => MOODS.includes(m))) err("moods must be a non-empty list of known moods");
  if (typeof song.energy !== "number" || song.energy < 1 || song.energy > 10) err("energy must be 1 to 10");
  if (song.fame !== 1 && song.fame !== 2 && song.fame !== 3) err("fame must be 1, 2 or 3");
  if (song.bpm != null && (typeof song.bpm !== "number" || song.bpm < 40 || song.bpm > 220)) err("bpm must be between 40 and 220");
  if (song.camelot != null && !parseCamelot(song.camelot)) err("camelot must look like 8A or 11B");
  if (song.beatGrid != null && (typeof song.beatGrid.firstDownbeat !== "number" || song.beatGrid.firstDownbeat < 0 || typeof song.beatGrid.beatsPerBar !== "number"))
    err("beatGrid needs firstDownbeat >= 0 and beatsPerBar");
  if (song.hook != null) {
    if (typeof song.hook.entry !== "number" || song.hook.entry < 0) err("hook.entry must be a time in seconds");
    if (song.hook.exit !== null && (typeof song.hook.exit !== "number" || song.hook.exit <= song.hook.entry)) err("hook.exit must be after hook.entry, or null");
  }
  if (song.vocals != null && (!Array.isArray(song.vocals) || !song.vocals.every((r) => Array.isArray(r) && r.length === 2 && r[0] < r[1])))
    err("vocals must be a list of [start, end] pairs");
  const media = song.media;
  if (!media || !Array.isArray(media.youtube)) err("media.youtube must be a list");
  else {
    if (!media.youtube.every((id) => YT_ID.test(id))) err("media.youtube has an invalid video id");
    if (media.youtube.length === 0 && !media.file) err("needs at least one YouTube id or a file");
  }
  if (!song.analysis || !["analyzer", "tap", "manual", "estimate"].includes(song.analysis.source)) err("analysis.source is missing or unknown");
  return errors;
}

export function validateLibrary(lib: unknown): string[] {
  if (typeof lib !== "object" || lib === null) return ["library is not an object"];
  const l = lib as Partial<Library>;
  if (l.version !== 1) return ["library.version must be 1"];
  if (!Array.isArray(l.songs)) return ["library.songs must be a list"];
  const errors = l.songs.flatMap(validateSong);
  const ids = new Set<string>();
  for (const s of l.songs) {
    if (ids.has(s.id)) errors.push(`${s.id}: duplicate id`);
    ids.add(s.id);
  }
  return errors;
}

/** Overlay songs win over base songs with the same id. Order: base order, then new songs. */
export function mergeSongs(base: Song[], overlay: Song[]): Song[] {
  const byId = new Map(base.map((s) => [s.id, s]));
  for (const s of overlay) byId.set(s.id, s);
  return [...byId.values()];
}

export async function loadSeedLibrary(url = `${import.meta.env.BASE_URL}library.json`): Promise<Song[]> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return [];
    const lib = (await res.json()) as Library;
    const errors = validateLibrary(lib);
    if (errors.length) console.warn("[DJmaxing] Seed library problems:", errors);
    return lib.songs.filter((s) => validateSong(s).length === 0);
  } catch {
    return [];
  }
}

/** Songs the user added or edited in this browser. */
export function loadLocalSongs(): Song[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const lib = JSON.parse(raw) as Library;
    return Array.isArray(lib.songs) ? lib.songs.filter((s) => validateSong(s).length === 0) : [];
  } catch {
    return [];
  }
}

export function saveLocalSongs(songs: Song[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, songs } satisfies Library));
  } catch {
    // Storage can be full or blocked (private mode). The export button still works.
  }
}

export function libraryJson(songs: Song[]): string {
  return JSON.stringify({ version: 1, songs } satisfies Library, null, 2);
}

/** Parses an imported library file and reports which songs were rejected. */
export function parseImport(text: string): { songs: Song[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { songs: [], errors: ["That file is not valid JSON."] };
  }
  const lib = data as Partial<Library>;
  if (!Array.isArray(lib.songs)) return { songs: [], errors: ["The file has no songs list. Expected { version: 1, songs: [...] }."] };
  const songs: Song[] = [];
  const errors: string[] = [];
  for (const s of lib.songs) {
    const e = validateSong(s);
    if (e.length) errors.push(...e);
    else songs.push(s as Song);
  }
  return { songs, errors };
}

export function blankSong(partial: Partial<Song> & Pick<Song, "title" | "artist">): Song {
  return {
    id: songId(partial.title, partial.artist),
    language: "hindi",
    moods: ["party"],
    year: null,
    energy: 6,
    fame: 2,
    bpm: null,
    camelot: null,
    beatGrid: null,
    hook: null,
    vocals: null,
    loudnessLufs: null,
    durationSec: null,
    media: { youtube: [], file: null, spotifyUri: null },
    analysis: { source: "manual", verified: false },
    ...partial,
  };
}

/** Pulls the 11-character id out of any YouTube URL form, or accepts a bare id. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (YT_ID.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return YT_ID.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    const v = u.searchParams.get("v");
    if (v && YT_ID.test(v)) return v;
    const m = /\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
