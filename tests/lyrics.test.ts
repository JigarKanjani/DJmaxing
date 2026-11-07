import { describe, expect, it } from "vitest";
import { hookFromLrc, parseLrc, pickRecord, type LrclibRecord } from "../src/lib/lyrics/hookFromLyrics";

const LRC = `
[00:05.00] Intro line nobody repeats
[00:10.00] Verse line one
[00:14.00] Verse line two
[00:20.00] Pre chorus
[00:24.00] Hey hey this is the hook
[00:28.00] Everybody sing it now
[00:32.00] Hey hey this is the hook
[00:36.00] Everybody sing it now
[00:40.00] Second verse starts
[00:44.00] Second verse continues
[00:52.00] Hey hey this is the hook
[00:56.00] Everybody sing it now
[01:00.00] Hey hey this is the hook
[01:04.00] Everybody sing it now
[01:10.00] Outro
`;

describe("lyric hooks", () => {
  it("parses LRC with multiple stamps per line", () => {
    const lines = parseLrc("[00:01.00][00:30.50] Same line\n[00:10.00] Other");
    expect(lines.map((l) => l.t)).toEqual([1, 10, 30.5]);
    expect(lines[0]!.key).toBe("same line");
  });

  it("finds the first chorus after the intro and hands over on a lyric line", () => {
    const h = hookFromLrc(parseLrc(LRC), 90)!;
    expect(h.entry).toBe(24);
    expect(h.exit).toBe(56); // first line at least 30 s after the entry
    expect(h.chorus[0]).toBe("Hey hey this is the hook");
  });

  it("returns null when nothing repeats", () => {
    expect(hookFromLrc(parseLrc("[00:01.00] a\n[00:02.00] b\n[00:03.00] c\n[00:04.00] d\n[00:05.00] e\n[00:06.00] f"), 60)).toBeNull();
  });

  it("picks the matching record closest in length", () => {
    const rec = (id: number, trackName: string, artistName: string, duration: number, synced = true): LrclibRecord => ({ id, trackName, artistName, duration, syncedLyrics: synced ? "[00:01.00] x" : null });
    const records = [rec(1, "Kala Chashma", "Amar Arshi, Badshah & Neha Kakkar", 240), rec(2, "Kala Chashma", "Amar Arshi, Badshah & Neha Kakkar", 187), rec(3, "Other Song", "Badshah", 187), rec(4, "Kala Chashma", "Badshah", 188, false)];
    expect(pickRecord(records, "Kala Chashma", "Badshah, Neha Kakkar", 188)?.id).toBe(2);
    expect(pickRecord(records, "Nope", "Nobody", 100)).toBeNull();
  });
});
