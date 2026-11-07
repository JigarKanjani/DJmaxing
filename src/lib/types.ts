// Shared data model. Mirrors docs/library-format.md exactly.

export const LANGUAGES = [
  "hindi",
  "punjabi",
  "english",
  "gujarati",
  "tamil",
  "telugu",
  "haryanvi",
  "bhojpuri",
  "marathi",
  "bengali",
  "other",
] as const;
export type Language = (typeof LANGUAGES)[number];

export const MOODS = [
  "dance",
  "party",
  "wedding",
  "bhangra",
  "romantic",
  "sad",
  "sufi",
  "retro",
  "gym",
  "hiphop",
  "garba",
  "pop",
  "edm",
  "devotional",
] as const;
export type Mood = (typeof MOODS)[number];

/** Moods that are slow or emotional. They only play when asked for, or while winding down. */
export const SLOW_MOODS: ReadonlySet<Mood> = new Set<Mood>(["romantic", "sad", "sufi", "devotional"]);

export interface BeatGrid {
  /** Time in seconds of any bar's first beat, in the media's own timeline. */
  firstDownbeat: number;
  beatsPerBar: number;
}

export interface Hook {
  entry: number;
  exit: number | null;
}

export interface Media {
  youtube: string[];
  file: string | null;
  spotifyUri: string | null;
}

export type AnalysisSource = "analyzer" | "tap" | "manual" | "estimate";

export interface Analysis {
  source: AnalysisSource;
  verified: boolean;
  notes?: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  language: Language;
  moods: Mood[];
  year?: number | null;
  energy: number;
  fame: 1 | 2 | 3;
  bpm?: number | null;
  camelot?: string | null;
  beatGrid?: BeatGrid | null;
  hook?: Hook | null;
  vocals?: Array<[number, number]> | null;
  loudnessLufs?: number | null;
  durationSec?: number | null;
  media: Media;
  analysis: Analysis;
}

export interface Library {
  version: 1;
  songs: Song[];
}

// ---- Set building ----

export type Moment = "warmup" | "peak" | "bangers" | "winddown";
export type Crowd = "small" | "medium" | "large";

export interface Room {
  languages: Language[];
  /** Empty means "any upbeat mood". */
  moods: Mood[];
  moment: Moment;
  crowd: Crowd;
  /** Target set length in minutes. */
  minutes: number;
  /** Seed for repeatable shuffles. Defaults to Date.now(). */
  seed?: number;
  /** Which media the set will play from; songs without that media are skipped. */
  playback: "youtube" | "local";
}

export type TransitionKind =
  /** Both tempos and keys fit: overlap the incoming build under the outgoing phrase end. */
  | "blend"
  /** Hard cut on the downbeat, with a very short fade to avoid clicks. */
  | "cut"
  /** No usable timing data: short equal-power crossfade. */
  | "fade";

export interface TransitionPlan {
  kind: TransitionKind;
  /** Seconds in the outgoing song's timeline where it should be fully gone. */
  outAt: number;
  /** Seconds in the incoming song's timeline where it should start playing. */
  inFrom: number;
  /** Seconds in the incoming song's timeline that should line up with outAt (its hook downbeat). */
  inAlign: number;
  /** Overlap length in seconds (0 for a cut). */
  overlap: number;
  /** Tempo ratio to apply to the incoming song for beat matching (local mode only). 1 = untouched. */
  rate: number;
  /** Human readable reason, shown in the set view. */
  why: string;
}

export interface SetEntry {
  song: Song;
  /** Seconds in the song's timeline where play starts (snapped hook entry). */
  start: number;
  /** Seconds where play ends if nothing else happens (snapped hook exit or song end). */
  end: number;
  /** Target energy for this slot of the night. */
  targetEnergy: number;
  /** Plan for leaving this song into the next. Null on the last song. */
  transition: TransitionPlan | null;
  /** Score breakdown for the move into this song (null for the first). */
  score: TransitionScore | null;
}

export interface TransitionScore {
  total: number;
  tempo: number;
  key: number;
  energy: number;
  variety: number;
}

export interface BuiltSet {
  entries: SetEntry[];
  /** Notes for the user, for example "Only 6 Garba songs, added 4 upbeat Hindi ones". */
  notes: string[];
  /** Total planned play time in seconds. */
  seconds: number;
}
