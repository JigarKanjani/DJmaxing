// Finds hooks for untimed songs from LRCLIB synced lyrics.
// Usage: npx tsx scripts/auto-hooks.ts [library.json] [--write]
// Only songs whose video is within a few seconds of the lyric audio's length get a hook,
// because lyric times are measured on the audio release, not on the video.

import { readFileSync, writeFileSync } from "node:fs";
import { findHookFromLyrics, MAX_LENGTH_GAP } from "../src/lib/lyrics/hookFromLyrics";
import type { Library } from "../src/lib/types";

const path = process.argv.find((a) => a.endsWith(".json")) ?? "public/library.json";
const write = process.argv.includes("--write");
const lib = JSON.parse(readFileSync(path, "utf8")) as Library;
const politeFetch: typeof fetch = (url, init) =>
  fetch(url, { ...init, headers: { ...(init?.headers ?? {}), "User-Agent": "DJmaxing/0.1 (https://github.com/JigarKanjani/DJmaxing)" } });

let applied = 0;
const rows: string[] = [];
for (const song of lib.songs) {
  if (song.hook) continue;
  try {
    const r = await findHookFromLyrics(song.title, song.artist, song.durationSec ?? null, politeFetch);
    const gap = r.lengthGap;
    const usable = r.hook && gap !== null && Math.abs(gap) <= MAX_LENGTH_GAP;
    rows.push(
      [song.id.padEnd(44), gap === null ? "  --" : gap.toFixed(0).padStart(4), r.hook ? `${r.hook.entry.toFixed(1)}-${r.hook.exit.toFixed(1)}` : "no hook", usable ? "USE " : "skip", r.hook?.chorus[0] ?? ""].join("  "),
    );
    if (usable && r.hook) {
      song.hook = { entry: r.hook.entry, exit: r.hook.exit };
      song.analysis = {
        ...song.analysis,
        notes: `Hook from LRCLIB synced lyrics (record ${r.record?.id}, chorus repeated ${r.hook.repeats} times; video and audio lengths differ by ${gap?.toFixed(0)} s). Energy and fame are estimates.`,
      };
      applied++;
    }
  } catch (e) {
    rows.push(`${song.id.padEnd(44)}  error: ${(e as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.log(rows.join("\n"));
console.log(`\n${applied} hooks ${write ? "written" : "found (dry run, pass --write to save)"}.`);
if (write) writeFileSync(path, JSON.stringify(lib, null, 2) + "\n");
