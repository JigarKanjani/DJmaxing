// End-to-end test of "My files" mode: generates three drum loops at different tempos, picks them
// as a folder, and checks the engine blends them with tempo stretching and key lock.
// Usage: node tests/e2e/local.e2e.cjs [baseUrl]
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.argv[2] || "http://127.0.0.1:4173/";

/** A 70-second four-on-the-floor loop: kick on every beat, accented on the one, hats in between. */
function drumLoopWav(bpm, seconds = 70, rate = 44100) {
  const n = Math.floor(seconds * rate);
  const data = new Int16Array(n);
  const beat = 60 / bpm;
  for (let b = 0; b * beat < seconds; b++) {
    const start = Math.floor(b * beat * rate);
    const accent = b % 4 === 0 ? 1 : 0.6;
    for (let i = 0; i < 0.18 * rate && start + i < n; i++) {
      const t = i / rate;
      const kick = Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 14) * accent;
      data[start + i] += Math.round(kick * 16000);
    }
    const hat = Math.floor((b + 0.5) * beat * rate);
    for (let i = 0; i < 0.03 * rate && hat + i < n; i++) data[hat + i] += Math.round((Math.random() * 2 - 1) * 3000 * Math.exp(-i / rate * 120));
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + n * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(n * 2, 40);
  return Buffer.concat([header, Buffer.from(data.buffer)]);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "djmaxing-e2e-"));
  const folder = path.join(dir, "Party");
  fs.mkdirSync(folder);
  const tempos = [120, 123, 126];
  const songs = tempos.map((bpm, i) => {
    const file = `Test Artist ${i} - Loop ${bpm}.wav`;
    fs.writeFileSync(path.join(folder, file), drumLoopWav(bpm));
    const bar = (4 * 60) / bpm;
    return {
      id: `loop-${bpm}`,
      title: `Loop ${bpm}`,
      artist: `Test Artist ${i}`,
      language: "english",
      moods: ["dance"],
      year: null,
      energy: 8,
      fame: 3,
      bpm,
      camelot: "8A",
      beatGrid: { firstDownbeat: 0, beatsPerBar: 4 },
      hook: { entry: 8 * bar, exit: 16 * bar },
      vocals: null,
      loudnessLufs: null,
      durationSec: 70,
      media: { youtube: [], file, spotifyUri: null },
      analysis: { source: "manual", verified: true },
    };
  });

  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => (m.type() === "error" || /unavailable/.test(m.text())) && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate((s) => {
    localStorage.setItem("djmaxing.library.v1", JSON.stringify({ version: 1, songs: s }));
    localStorage.setItem("djmaxing.room.v1", JSON.stringify({ languages: ["english"], moods: [], moment: "bangers", crowd: "large", minutes: 2, playback: "local" }));
  }, songs);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("input[webkitdirectory]").setInputFiles(folder);
  await page.getByText(/3 media files, 3 in the library/).waitFor();
  await page.getByRole("button", { name: /Build the set/ }).click();
  console.log("Transitions:", (await page.locator(".set-row .tag").allInnerTexts()).join(" | "));
  await page.getByRole("button", { name: "Start the party" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();

  let log = "";
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    log = (await page.locator(".log").textContent()) || "";
    if ((log.match(/Live:/g) || []).length >= 3) break;
  }
  console.log("---- mix log ----\n" + log);
  console.log("---- errors ----\n" + (errors.join("\n") || "none"));
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const lives = (log.match(/Live:/g) || []).length;
  const blends = (log.match(/Blending into/g) || []).length;
  const keyLockMissing = /key lock unavailable/.test(log);
  if (lives < 3 || blends < 2 || keyLockMissing) {
    console.error(`FAIL: lives ${lives}, blends ${blends}, key lock ${keyLockMissing ? "missing" : "on"}`);
    process.exit(1);
  }
  console.log(`PASS: ${lives} songs live, ${blends} beat-matched blends, key lock on`);
})();
