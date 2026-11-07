import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeSongs, parseImport, parseYouTubeId, songId, validateLibrary, validateSong } from "../src/lib/library";
import { fadeGains } from "../src/lib/engine";
import { loudnessTrim, resolveFile } from "../src/lib/local/LocalEngine";
import { estimateEnergy, foldTempo, parseFileName } from "../src/lib/local/quickAnalyze";
import { bestMatch, normalize, pkceChallenge } from "../src/lib/spotify/spotify";
import { beatAt, fitTaps, normaliseDownbeat } from "../src/lib/tap";
import { song } from "./fixtures";

describe("library", () => {
  it("makes stable slugs", () => {
    expect(songId("Kala Chashma", "Badshah, Neha Kakkar")).toBe("kala-chashma-badshah");
    expect(songId("Désolé (Remix)", "X")).toBe("desole-remix-x");
  });
  it("parses every YouTube link form", () => {
    for (const u of [
      "dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    ])
      expect(parseYouTubeId(u), u).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://example.com")).toBeNull();
  });
  it("validates songs and catches common mistakes", () => {
    expect(validateSong(song())).toEqual([]);
    const bad = song({ camelot: "13A", energy: 11, hook: { entry: 50, exit: 40 } });
    const errs = validateSong(bad).join(" ");
    expect(errs).toMatch(/camelot/);
    expect(errs).toMatch(/energy/);
    expect(errs).toMatch(/hook.exit/);
    expect(validateLibrary({ version: 1, songs: [song({ id: "a" }), song({ id: "a" })] }).join()).toMatch(/duplicate/);
  });
  it("merges with local edits winning", () => {
    const a = song({ id: "x", energy: 3 });
    const b = song({ id: "x", energy: 9 });
    expect(mergeSongs([a], [b])[0]!.energy).toBe(9);
  });
  it("reports rejected songs on import", () => {
    const r = parseImport(JSON.stringify({ version: 1, songs: [song({ id: "ok" }), { id: "Bad Id" }] }));
    expect(r.songs).toHaveLength(1);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(parseImport("nope").errors[0]).toMatch(/not valid JSON/);
  });
  it("ships a valid seed library", () => {
    const path = new URL("../public/library.json", import.meta.url);
    if (!existsSync(path)) return;
    const lib = JSON.parse(readFileSync(path, "utf8"));
    expect(validateLibrary(lib)).toEqual([]);
  });
});

describe("tap tempo", () => {
  it("fits a steady tap and survives a missed beat", () => {
    const beat = 60 / 124;
    const taps = [0, 1, 2, 3, 5, 6, 7, 8, 9].map((i) => 10 + i * beat + (i % 2 ? 0.01 : -0.01));
    const r = fitTaps(taps)!;
    expect(r.bpm).toBeCloseTo(124, 0);
    expect(r.jitterMs).toBeLessThan(15);
  });
  it("normalises the downbeat and counts beats", () => {
    expect(normaliseDownbeat(33, 120)).toBeCloseTo(1); // bar = 2 s
    const b = beatAt(4.6, 120, 0.5);
    expect(b.beat).toBe(1); // 4.6 - 0.5 = 4.1 s = beat 8.2, which is beat 1 of bar 3
    expect(b.bar).toBe(3);
  });
  it("needs enough taps", () => {
    expect(fitTaps([1, 2])).toBeNull();
  });
});

describe("local playback helpers", () => {
  it("finds picked files by path or name", () => {
    const f = new File([""], "a.mp3");
    const files = new Map([["Party/Hindi/Kala Chashma.mp3", f]]);
    expect(resolveFile(files, "Hindi/Kala Chashma.mp3")).toBe(f);
    expect(resolveFile(files, "Party/Hindi/Kala Chashma.mp3")).toBe(f);
    expect(resolveFile(files, "kala chashma.mp3")).toBe(f);
    expect(resolveFile(files, "missing.mp3")).toBeNull();
  });
  it("levels loudness towards -14 LUFS, within limits", () => {
    expect(loudnessTrim(song({ loudnessLufs: -14 }))).toBeCloseTo(1);
    expect(loudnessTrim(song({ loudnessLufs: -8 }))).toBeCloseTo(10 ** (-6 / 20));
    expect(loudnessTrim(song({ loudnessLufs: -40 }))).toBe(2);
    expect(loudnessTrim(song({ loudnessLufs: null }))).toBe(1);
  });
  it("reads artist and title from file names", () => {
    expect(parseFileName("Music/03 - Badshah - Kala Chashma.mp3")).toEqual({ artist: "Badshah", title: "Kala Chashma" });
    expect(parseFileName("song_name.m4a")).toEqual({ artist: "Unknown artist", title: "song name" });
    expect(foldTempo(62)).toBe(124);
    expect(foldTempo(200)).toBe(100);
    expect(estimateEnergy(-9, 128)).toBeGreaterThan(estimateEnergy(-20, 80));
  });
  it("keeps crossfades at steady loudness", () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const g = fadeGains("fade", p);
      expect(g.incoming ** 2 + g.outgoing ** 2).toBeCloseTo(1);
    }
    expect(fadeGains("blend", 0.25)).toEqual({ incoming: Math.sin(Math.PI / 4), outgoing: 1 });
    expect(fadeGains("blend", 1).outgoing).toBeCloseTo(0);
  });
});

describe("spotify helpers", () => {
  it("matches the right track", () => {
    const tracks = [
      { uri: "spotify:track:1", name: "Kala Chashma - Remix", artists: [{ name: "DJ Someone" }] },
      { uri: "spotify:track:2", name: 'Kala Chashma (From "Baar Baar Dekho")', artists: [{ name: "Amar Arshi" }, { name: "Badshah" }] },
    ];
    expect(bestMatch({ title: "Kala Chashma", artist: "Badshah, Neha Kakkar" }, tracks)?.uri).toBe("spotify:track:2");
    expect(bestMatch({ title: "Something Else", artist: "Nobody" }, tracks)).toBeNull();
    expect(normalize("Tum Hi Ho (From \"Aashiqui 2\")")).toBe("tum hi ho");
  });
  it("builds the RFC 7636 PKCE challenge", async () => {
    // Example verifier and challenge from RFC 7636, appendix B.
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
