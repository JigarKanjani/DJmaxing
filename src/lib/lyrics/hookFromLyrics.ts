// Finds a song's hook from time-synced lyrics (LRC), using LRCLIB, a free open lyrics database.
//
// The chorus is the block of lyric lines that repeats most. Its first full occurrence after the
// intro is where a DJ would drop in, and the lyric line that follows a chorus is a natural place
// to hand over. Lyric times follow the audio release, so they only transfer to a music video when
// the video and the audio are the same length.

export interface LrcLine {
  t: number;
  text: string;
  key: string;
}

export interface LyricHook {
  entry: number;
  exit: number;
  /** Lines in the chosen chorus block, for display. */
  chorus: string[];
  /** How many times the chorus block's lines repeat in total. Higher is more certain. */
  repeats: number;
}

export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) {
      const t = Number(m[1]) * 60 + Number(m[2]);
      if (Number.isFinite(t)) out.push({ t, text, key: normaliseLine(text) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export function normaliseLine(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Picks the chorus: runs of consecutive lines that each appear 2 or more times, scored by
 * how often they repeat. Returns the first occurrence that starts after the intro.
 */
export function hookFromLrc(lines: LrcLine[], durationSec: number, opts: { minStart?: number; minLen?: number; maxLen?: number } = {}): LyricHook | null {
  const minStart = opts.minStart ?? 12;
  const minLen = opts.minLen ?? 30;
  const maxLen = opts.maxLen ?? 75;
  const sung = lines.filter((l) => l.key.length > 0);
  if (sung.length < 6) return null;
  const counts = new Map<string, number>();
  for (const l of sung) counts.set(l.key, (counts.get(l.key) ?? 0) + 1);

  // Group consecutive repeated lines into blocks.
  interface Block {
    start: number;
    end: number;
    score: number;
    sig: string;
  }
  const blocks: Block[] = [];
  let i = 0;
  while (i < sung.length) {
    if ((counts.get(sung[i]!.key) ?? 0) < 2) {
      i++;
      continue;
    }
    let j = i;
    let score = 0;
    while (j < sung.length && (counts.get(sung[j]!.key) ?? 0) >= 2) {
      score += counts.get(sung[j]!.key)!;
      j++;
    }
    blocks.push({ start: i, end: j, score, sig: sung[i]!.key });
    i = j;
  }
  if (blocks.length === 0) return null;
  const best = Math.max(...blocks.map((b) => b.score));
  // Blocks within 70% of the best score count as the chorus; take the first one after the intro.
  const strong = blocks.filter((b) => b.score >= best * 0.7);
  const top = strong.reduce((a, b) => (b.score > a.score ? b : a));
  // The first time the chorus's opening line is sung after the intro. Earlier choruses are
  // sometimes shorter and score lower as blocks, but they are the same hook.
  const firstLine = sung.findIndex((l) => l.key === top.sig && l.t >= minStart);
  const chosen = firstLine >= 0 ? { ...top, start: firstLine, end: firstLine + (top.end - top.start) } : (strong.find((b) => sung[b.start]!.t >= minStart) ?? top);
  const entry = sung[chosen.start]!.t;

  // Hand over at the first lyric line that starts at least minLen after the entry.
  const limit = Math.min(entry + maxLen, durationSec > 0 ? durationSec - 2 : Number.POSITIVE_INFINITY);
  const next = lines.find((l) => l.t >= entry + minLen && l.t <= limit);
  const exit = next ? next.t : Math.min(limit, entry + minLen);
  if (!(exit > entry + 10)) return null;
  return {
    entry: Math.round(entry * 100) / 100,
    exit: Math.round(exit * 100) / 100,
    chorus: sung.slice(chosen.start, Math.min(chosen.end, chosen.start + 4)).map((l) => l.text),
    repeats: chosen.score,
  };
}

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  duration: number;
  syncedLyrics: string | null;
}

const LRCLIB = "https://lrclib.net/api/search";

function simple(s: string): string {
  return normaliseLine(s.replace(/\(.*?\)|\[.*?\]/g, " "));
}

/**
 * Picks the LRCLIB record that matches the title and artist with synced lyrics, closest in length
 * to the media. Exported for tests.
 */
export function pickRecord(records: LrclibRecord[], title: string, artist: string, durationSec: number | null): LrclibRecord | null {
  const t = simple(title);
  const a = simple(artist.split(/,|&/)[0] ?? artist);
  const ok = records.filter((r) => {
    if (!r.syncedLyrics) return false;
    const rt = simple(r.trackName);
    const ra = simple(r.artistName);
    return (rt === t || rt.startsWith(t) || t.startsWith(rt)) && (ra.includes(a) || a.includes(ra.split(" ")[0] ?? ""));
  });
  if (ok.length === 0) return null;
  if (!durationSec) return ok[0]!;
  return ok.reduce((best, r) => (Math.abs(r.duration - durationSec) < Math.abs(best.duration - durationSec) ? r : best));
}

export interface LyricLookup {
  hook: LyricHook | null;
  record: LrclibRecord | null;
  /** Media length minus audio length. Hooks are only trusted when this is small. */
  lengthGap: number | null;
}

/** Largest length gap (seconds) at which lyric times are trusted on a music video. */
export const MAX_LENGTH_GAP = 4;

export async function findHookFromLyrics(title: string, artist: string, durationSec: number | null, fetchImpl: typeof fetch = fetch): Promise<LyricLookup> {
  const mainArtist = artist.split(/,|&/)[0]?.trim() ?? artist;
  const params = new URLSearchParams({ track_name: title, artist_name: mainArtist });
  const res = await fetchImpl(`${LRCLIB}?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Lyrics lookup failed (${res.status}).`);
  const record = pickRecord((await res.json()) as LrclibRecord[], title, artist, durationSec);
  if (!record?.syncedLyrics) return { hook: null, record: null, lengthGap: null };
  const lengthGap = durationSec ? durationSec - record.duration : null;
  const hook = hookFromLrc(parseLrc(record.syncedLyrics), durationSec ?? record.duration);
  return { hook, record, lengthGap };
}
