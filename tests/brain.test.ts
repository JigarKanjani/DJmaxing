import { describe, expect, it } from "vitest";
import { buildSet } from "../src/lib/brain/buildSet";
import { compatibleKeys, keyCompatibility, keyNameToCamelot } from "../src/lib/brain/camelot";
import { energyCurve } from "../src/lib/brain/energyCurve";
import { barSeconds, phraseEndBefore, playWindow, snapToBar } from "../src/lib/brain/grid";
import { MAX_DRIFT_SECONDS, planTransition } from "../src/lib/brain/planner";
import { mainArtist, tempoMatch } from "../src/lib/brain/scoring";
import { buildPool } from "../src/lib/brain/selection";
import type { Room, Song } from "../src/lib/types";
import { gridSong, song } from "./fixtures";

describe("camelot", () => {
  it("maps every key name to the right Camelot code", () => {
    const expected: Record<string, string> = {
      C: "8B", G: "9B", D: "10B", A: "11B", E: "12B", B: "1B", "F#": "2B", Db: "3B", Ab: "4B", Eb: "5B", Bb: "6B", F: "7B",
      Am: "8A", Em: "9A", Bm: "10A", "F#m": "11A", "C#m": "12A", "G#m": "1A", "Ebm": "2A", "Bbm": "3A", Fm: "4A", Cm: "5A", Gm: "6A", Dm: "7A",
    };
    for (const [name, code] of Object.entries(expected)) expect(keyNameToCamelot(name), name).toBe(code);
    expect(keyNameToCamelot("A minor")).toBe("8A");
    expect(keyNameToCamelot("F# major")).toBe("2B");
    expect(keyNameToCamelot("H")).toBeNull();
  });

  it("scores harmonic moves from best to worst", () => {
    expect(keyCompatibility("8A", "8A")).toBe(1);
    expect(keyCompatibility("8A", "9A")).toBe(0.9);
    expect(keyCompatibility("12A", "1A")).toBe(0.9); // wraps round the wheel
    expect(keyCompatibility("8A", "8B")).toBe(0.85);
    expect(keyCompatibility("8A", "10A")).toBe(0.6);
    expect(keyCompatibility("8A", "3A")).toBe(0.45);
    expect(keyCompatibility("8A", "2B")).toBe(0.15);
    expect(keyCompatibility(null, "8A")).toBe(0.5);
    expect(compatibleKeys("1A")).toEqual(["1A", "12A", "2A", "1B", "3A"]);
  });
});

describe("tempo", () => {
  it("treats half and double time as the same pulse", () => {
    const m = tempoMatch(170, 85);
    expect(m.diff).toBeCloseTo(0, 5);
    expect(m.score).toBe(1);
    expect(m.rate).toBeCloseTo(1, 5);
  });
  it("gives the stretch rate that locks the incoming song to the outgoing tempo", () => {
    const m = tempoMatch(128, 124);
    expect(m.rate).toBeCloseTo(128 / 124, 6);
    expect(m.score).toBeGreaterThan(0.6);
    expect(tempoMatch(128, 100).score).toBe(0);
    expect(tempoMatch(null, 100).score).toBe(0.5);
  });
  it("finds the main artist", () => {
    expect(mainArtist(song({ artist: "Badshah, Aastha Gill & Ikka" }))).toBe("badshah");
    expect(mainArtist(song({ artist: "Diljit Dosanjh feat. Sia" }))).toBe("diljit dosanjh");
  });
});

describe("grid", () => {
  const s = gridSong(120, "8A"); // bar = 2 s, phrase = 16 s, first downbeat 0.5 s
  it("snaps to bars", () => {
    expect(barSeconds(120)).toBe(2);
    expect(snapToBar(s, 10.9)).toBeCloseTo(10.5);
    expect(snapToBar(s, 10.9, "floor")).toBeCloseTo(10.5);
    expect(snapToBar(s, 10.6, "ceil")).toBeCloseTo(12.5);
  });
  it("ends on a whole phrase counted from the hook", () => {
    expect(phraseEndBefore(s, 32.5, 80)).toBeCloseTo(32.5 + 2 * 16);
    expect(phraseEndBefore(s, 32.5, 40)).toBeCloseTo(32.5 + 3 * 2); // shorter than a phrase: whole bars
  });
  it("plays untimed songs from a safe default", () => {
    const w = playWindow(song({ hook: null, durationSec: 240 }));
    expect(w.start).toBe(30);
    expect(w.end).toBe(105);
  });
});

describe("energy curve", () => {
  it("rises for warm-up, falls for wind-down, stays high for bangers", () => {
    const up = energyCurve(10, "warmup", "medium");
    expect(up[9]!).toBeGreaterThan(up[0]!);
    const down = energyCurve(10, "winddown", "medium");
    expect(down[9]!).toBeLessThan(down[0]!);
    expect(Math.min(...energyCurve(12, "bangers", "large"))).toBeGreaterThanOrEqual(7.5);
  });
  it("rides waves at peak instead of a flat line", () => {
    const peak = energyCurve(20, "peak", "medium").slice(5);
    expect(Math.max(...peak) - Math.min(...peak)).toBeGreaterThan(1.5);
  });
});

describe("transition planner", () => {
  const plan = (a: Song, b: Song, playback: Room["playback"] = "youtube") => {
    const wa = playWindow(a);
    const wb = playWindow(b);
    return planTransition({ outgoing: a, outStart: wa.start, outEnd: wa.end, incoming: b, inEntry: wb.start, playback });
  };

  it("blends same-tempo, same-key songs so the hook lands on the handover", () => {
    const a = gridSong(120, "8A");
    const b = gridSong(120, "9A");
    const p = plan(a, b);
    expect(p.kind).toBe("blend");
    expect(p.inAlign).toBeCloseTo(playWindow(b).start);
    expect(p.inAlign - p.inFrom).toBeCloseTo(p.overlap);
    expect(p.overlap).toBeCloseTo(8); // 4 bars at 120 BPM
  });

  it("shortens or drops a YouTube blend when the tempo gap would flam", () => {
    const p1 = plan(gridSong(120, "8A"), gridSong(121, "8A"));
    // 0.83% gap: drift over the overlap must stay under the limit
    expect(p1.kind).toBe("blend");
    expect(p1.overlap * (1 / 120)).toBeLessThanOrEqual(MAX_DRIFT_SECONDS + 1e-9);
    const p2 = plan(gridSong(120, "8A"), gridSong(126, "8A"));
    expect(p2.kind).toBe("cut");
  });

  it("time-stretches local files for long blends", () => {
    const p = plan(gridSong(128, "8A"), gridSong(124, "8A"), "local");
    expect(p.kind).toBe("blend");
    expect(p.rate).toBeCloseTo(128 / 124, 6);
    // 8 bars of the incoming song, played faster
    expect(p.overlap).toBeCloseTo((8 * barSeconds(124)) / p.rate, 6);
    expect(p.inAlign - p.inFrom).toBeCloseTo(p.overlap * p.rate, 6);
  });

  it("cuts when keys clash or both songs sing over the blend", () => {
    expect(plan(gridSong(120, "8A"), gridSong(120, "2B")).kind).toBe("cut");
    const a = gridSong(120, "8A", { vocals: [[0, 500]] });
    const b = gridSong(120, "8A", { vocals: [[0, 500]] });
    expect(plan(a, b).kind).toBe("cut");
  });

  it("falls back to a short fade when timing is unknown", () => {
    const p = plan(song(), song());
    expect(p.kind).toBe("fade");
    expect(p.overlap).toBe(1.5);
  });

  it("only cuts on devices that cannot fade", () => {
    const a = gridSong(120, "8A");
    const b = gridSong(120, "8A");
    const p = planTransition({ outgoing: a, outStart: 10, outEnd: 60, incoming: b, inEntry: 32.5, playback: "youtube", cutsOnly: true });
    expect(p.kind).toBe("cut");
  });
});

describe("pool and set", () => {
  const room: Room = { languages: ["hindi"], moods: [], moment: "peak", crowd: "medium", minutes: 20, seed: 42, playback: "youtube" };

  it("keeps slow songs out of a peak set and tops up with other languages when short", () => {
    const lib = [
      song({ language: "hindi", moods: ["romantic"] }),
      song({ language: "hindi", moods: ["dance"] }),
      song({ language: "punjabi", moods: ["bhangra"], fame: 3 }),
    ];
    const pool = buildPool(lib, room, 3);
    expect(pool.songs.map((s) => s.language)).toEqual(["hindi", "punjabi"]);
    expect(pool.fillers.size).toBe(1);
    expect(pool.notes[0]).toMatch(/well-known songs from other languages/);
  });

  it("builds a repeatable set with no repeated songs or back-to-back artists", () => {
    const lib: Song[] = [];
    for (let i = 0; i < 40; i++) {
      lib.push(gridSong(118 + (i % 8), `${(i % 12) + 1}A`, { artist: `Artist ${i % 9}`, energy: 4 + (i % 7), fame: ((i % 3) + 1) as 1 | 2 | 3 }));
    }
    const a = buildSet(lib, room);
    const b = buildSet(lib, room);
    expect(a.entries.map((e) => e.song.id)).toEqual(b.entries.map((e) => e.song.id));
    expect(new Set(a.entries.map((e) => e.song.id)).size).toBe(a.entries.length);
    for (let i = 1; i < a.entries.length; i++) {
      expect(mainArtist(a.entries[i]!.song)).not.toBe(mainArtist(a.entries[i - 1]!.song));
    }
    expect(a.seconds).toBeGreaterThan(15 * 60);
    expect(a.entries.at(-1)!.transition).toBeNull();
    expect(a.entries.slice(0, -1).every((e) => e.transition !== null)).toBe(true);
  });

  it("follows the energy curve better than a random order", () => {
    const lib: Song[] = [];
    for (let i = 0; i < 30; i++) lib.push(song({ energy: 1 + (i % 10), artist: `A${i}` }));
    const set = buildSet(lib, { ...room, moment: "warmup", minutes: 12 });
    const err = set.entries.reduce((s, e) => s + Math.abs(e.song.energy - e.targetEnergy), 0) / set.entries.length;
    expect(err).toBeLessThan(1.2);
  });

  it("skips songs without media for the chosen playback", () => {
    const lib = [song({ media: { youtube: [], file: "x.mp3", spotifyUri: null } }), song()];
    const set = buildSet(lib, { ...room, minutes: 2 });
    expect(set.entries.every((e) => e.song.media.youtube.length > 0)).toBe(true);
  });
});

describe("short hooks", () => {
  it("extends a too-short hook by whole phrases, keeping the handover on a phrase end", () => {
    const s = gridSong(120, "8A", { hook: { entry: 40.5, exit: 56.5 } }); // one 16 s phrase
    const w = playWindow(s);
    expect(w.start).toBeCloseTo(40.5);
    expect(w.end).toBeCloseTo(40.5 + 32); // two phrases
  });
});
