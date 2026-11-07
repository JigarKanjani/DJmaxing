// End-to-end smoke test: builds a short English set and plays it through real YouTube embeds.
// Usage: node tests/e2e/party.e2e.cjs [baseUrl] [screenshotDir]
// Requires Playwright (preinstalled in CI images, or `npm i -D playwright`) and network access to youtube.com.
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:4173/";
const SHOTS = process.argv[3] || ".";
// Cloud CI machines are often refused by label music videos (YouTube error 150) even though they
// play for normal visitors. Set E2E_VIDEO to a video that plays from your machine to test the engine.
const OVERRIDE = process.env.E2E_VIDEO || null;

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  // Give the English songs short, timed hooks with a beat grid, so transitions happen quickly.
  const lib = await (await fetch(new URL("library.json", BASE))).json();
  const english = lib.songs.filter((s) => s.language === "english").slice(0, 6);
  const timed = english.map((s) => ({
    ...s,
    bpm: process.env.E2E_NO_GRID ? null : 120,
    camelot: "8A",
    beatGrid: process.env.E2E_NO_GRID ? null : { firstDownbeat: 0.5, beatsPerBar: 4 },
    hook: { entry: 40.5, exit: 56.5 },
    media: OVERRIDE ? { ...s.media, youtube: [OVERRIDE] } : s.media,
    analysis: { source: "manual", verified: true },
  }));
  await page.evaluate((songs) => {
    localStorage.setItem("djmaxing.library.v1", JSON.stringify({ version: 1, songs }));
    localStorage.setItem("djmaxing.room.v1", JSON.stringify({ languages: ["english"], moods: [], moment: "peak", crowd: "medium", minutes: 2, playback: "youtube" }));
  }, timed);
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}/1-room.png` });

  await page.getByRole("button", { name: /Build the set/ }).click();
  const rows = await page.locator(".set-row").count();
  const kinds = await page.locator(".set-row .tag").allInnerTexts();
  console.log("Set rows:", rows, "transitions:", kinds.join(" | "));
  await page.screenshot({ path: `${SHOTS}/2-set.png` });

  await page.getByRole("button", { name: "Start the party" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("button.btn.pink.big")?.hasAttribute("disabled"), null, { timeout: 30000 });
  await page.getByRole("button", { name: "Play", exact: true }).click();

  const deadline = Date.now() + 75000;
  let log = "";
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    log = (await page.locator(".log").textContent().catch(() => "")) || "";
    if ((log.match(/Live:/g) || []).length >= 3) break;
  }
  await page.screenshot({ path: `${SHOTS}/3-playing.png` });
  console.log("---- mix log ----\n" + log);
  console.log("---- page errors ----\n" + (errors.join("\n") || "none"));
  const lives = (log.match(/Live:/g) || []).length;
  const transitions = (log.match(/(Blending|Cutting|Fading) into/g) || []).length;
  await browser.close();
  if (lives < 2 || transitions < 1) {
    console.error(`FAIL: expected at least 2 live songs and 1 transition, got ${lives} and ${transitions}`);
    process.exit(1);
  }
  console.log(`PASS: ${lives} songs went live, ${transitions} transitions`);
})();
