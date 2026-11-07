# DJmaxing

An automatic party DJ. Tell it the room (languages, mood, moment of the night, crowd size), and it
builds the set, plays each song from its best part, and hands over to the next on the beat.

- **YouTube mode** plays official music videos on two visible decks and times every handover to the
  phrase, so the next hook lands as the last one ends.
- **My files mode** mixes your own audio or music-video files with real DJ techniques: tempo
  stretching with key lock, 8-bar blends, a bass swap halfway through, loudness levelling and
  visuals for songs without video.
- **Spotify** saves the finished set as a private playlist, for mixing in djay Pro, rekordbox or
  Serato with your Premium account.

The repository ships with 84 well-known Hindi, Punjabi, English and Gujarati party songs, each with
official, embeddable YouTube videos (checked November 7, 2026, see `docs/seed-sources.md`). 55 of
them have a hook found automatically from free synced lyrics (see "Hooks from lyrics" below).

Live: https://djmaxing.netlify.app (Netlify, free) and https://djmaxing.vercel.app (Vercel).

## Quick start (your computer)

Needs Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://127.0.0.1:5173, pick the languages, press **Build the set**, then **Start the party**
and **Play**. Keyboard: `Space` pause, `N` next song, `H` hold the current song.

## Put it online (Netlify, free)

`netlify.toml` and `netlify/functions/youtube-search.mts` are ready. In Netlify choose
**Add new project > Import an existing project**, pick this repository, and deploy. Netlify then
redeploys on every push. Add the optional variables below under **Site configuration > Environment
variables** (`YOUTUBE_API_KEY` scoped to Functions).

## Or Vercel (also free)

1. Push this repository to GitHub (it can stay public).
2. On vercel.com, choose **Add New > Project**, import the repository, keep the detected settings
   (Vite, `npm run build`, output `dist`) and deploy. `vercel.json` already sets the headers YouTube
   needs.
3. Optional connections, under **Project Settings > Environment Variables**, then redeploy:

| Variable | What it does | Secret? |
|---|---|---|
| `VITE_SPOTIFY_CLIENT_ID` | Turns on **Save to Spotify**. | No. It is a public client ID; sign-in uses PKCE, so there is no client secret anywhere. |
| `YOUTUBE_API_KEY` | Turns on **Search YouTube** in the Library. | Yes. It is read only by the server function `api/youtube-search.ts` and never reaches the browser. |

### About keys and a public repository

Nothing secret is in the code. Never commit a `.env` file (it is in `.gitignore`).

- A **GitHub Actions secret** only protects a value while CI runs. Anything prefixed `VITE_` is
  copied into the public JavaScript at build time, so a secret API key must never use that prefix.
- Put the YouTube key in **Vercel environment variables** without the `VITE_` prefix, as above. The
  server function also refuses requests from other websites, so others cannot use up your daily
  quota.

## Spotify setup (optional)

Spotify's developer rules do not allow an app to mix, overlap or segue Spotify audio, or play it
alongside video. So DJmaxing never plays Spotify itself. It saves the set's order as a playlist,
and Spotify-licensed DJ software does the mixing.

1. Go to https://developer.spotify.com/dashboard and choose **Create app**. Select **Web API**.
2. Add redirect URIs, exactly:
   - `http://127.0.0.1:5173/` for local development (Spotify does not accept `localhost`).
   - `https://YOUR-PROJECT.vercel.app/` for the deployed site.
3. Copy the **Client ID** into `VITE_SPOTIFY_CLIENT_ID` (in `.env.local` locally, or in Vercel).
4. Since February 2026, apps in Development Mode need the **app owner to have Spotify Premium**
   and allow up to **5 users**. Add each person under **User Management** in the dashboard.

The export follows the February 2026 API: `POST /me/playlists`, `POST /playlists/{id}/items`, and
searches of at most 10 results.

## YouTube search key (optional)

Without it, add songs by pasting a YouTube link. To enable search:

1. In Google Cloud Console, create a project and enable **YouTube Data API v3**.
2. Create an **API key**. Restrict it to the YouTube Data API.
3. Set `YOUTUBE_API_KEY` in Vercel. Each search uses 100 of the free 10,000 daily units, and
   results are cached for a day.

## Timing songs (makes the mixes good)

Songs mix on the beat once they have a tempo, a downbeat and a hook. In **Library**, open a song:

| Key | Action |
|---|---|
| `Space` | Play or pause |
| `T` | Tap along to the beat. 8 or more taps set the tempo (a least-squares fit, so one sloppy tap does not matter). |
| `D` | Press on the first beat of a bar ("the one"). The pink light should then flash on every one. |
| `I` | The hook starts here (snapped to the bar) |
| `O` | Hand over to the next song here |
| `P` | Preview the hook with a two-bar run-up |

Choose the key in Camelot notation if you know it. Then press **Save as checked**.

Edits are stored in this browser. Use **Export JSON** to back them up, or replace
`public/library.json` with the export and commit it, so every device gets your timings.

Untimed songs still play: they start 30 seconds in and use short fades.

### Hooks from lyrics

**Library > Find hooks from lyrics** (or **Find hook from lyrics** in the curator) looks the song up on
LRCLIB, a free open database of time-synced lyrics. The chorus is the block of lines that repeats
most; play starts on its first line and hands over on a lyric line about 30 to 75 seconds later.
Lyric times are measured on the audio release, so a hook is only set automatically when the video is
within 4 seconds of that audio's length. These hooks are estimates: preview them with `P`.

To refresh the shipped library: `npx tsx scripts/auto-hooks.ts public/library.json --write`.

Songs with a hook but no beat grid hand over with a 3-second fade that starts the next song a few
seconds early, so its chorus arrives as the previous song ends.

## Your own files and the analyser

Switch **Party** to **My files** and choose a folder. Files never leave your computer.

- **Quick-analyse** in the browser measures tempo and a beat position for new files.
- For proper data (key, downbeats, hook, loudness, optional vocals), run the Python analyser and
  import its JSON in **Library**:

```bash
cd analyzer && python -m venv .venv && . .venv/bin/activate && pip install -r requirements-core.txt
```

```bash
python -m djmax_analyze ~/Music/party -o library.local.json
```

Run it on the same folder you pick in the app, so file paths match. See `analyzer/README.md` for
the optional `--tier full` backends (Beat This, Essentia, All-In-One, audio-separator).

## How it works

```
Room ─▶ pool (language, mood, playable media) ─▶ energy curve for the night
     ─▶ beam search over song order ─▶ transition plan per handover ─▶ engine
```

- **Energy curve** (`src/lib/brain/energyCurve.ts`): warm-up rises, peak rides waves of big songs
  with a breather, bangers stay near the top, wind-down eases off. Crowd size shifts it.
- **Ordering** (`order.ts`): a beam search scores each move on energy fit, tempo match (85 and 170
  BPM count as the same pulse), Camelot key compatibility and variety (no back-to-back artist,
  filler languages spread out). It also chooses which songs to use, not only their order.
- **Transitions** (`planner.ts`):
  - *Blend*: the next song's build-up plays under the last bars, so its hook lands on the outgoing
    phrase end. On YouTube, tempo cannot change, so blend length is limited to keep the two kicks
    within 40 ms of each other. With your own files, the next song is time-stretched to match, so
    8-bar blends stay locked.
  - *Cut*: on the downbeat, when keys clash, tempos are too far apart, or both songs have vocals.
  - *Fade*: a short equal-power fade when timing data is missing.
- **YouTube engine** (`src/lib/youtube/YouTubeEngine.ts`): two visible players. The next video
  loads muted, parks at its start point, and starts early by the measured start-up delay. In
  testing, hooks landed within 20 to 50 ms of plan. Blocked videos fall back to backup IDs, then
  are skipped. iPhone and iPad ignore volume control on embedded video, so they cut instead.
- **Local engine** (`src/lib/local/LocalEngine.ts`): Web Audio graph with Signalsmith Stretch
  (key-locked tempo), per-deck loudness trim to -14 LUFS, low-shelf bass swap, a hard limiter, muted
  video kept in sync with the audio clock, and Butterchurn visuals.

## Ads

DJmaxing uses YouTube's own embedded player and does not block or skip ads. YouTube's API terms
require that, and ads pay the artists. Signing the party computer's browser into **YouTube
Premium** removes them. **My files** mode has no ads.

## Tests

```bash
npm test
```

```bash
cd analyzer && python -m pytest -q
```

Browser end-to-end tests (need Playwright and a running `npm run build && npm run preview`):

```bash
node tests/e2e/party.e2e.cjs http://127.0.0.1:4173/
```

```bash
node tests/e2e/local.e2e.cjs http://127.0.0.1:4173/
```

Cloud machines are often refused by label music videos (YouTube error 150) even though the same
videos play for normal visitors. If that happens, set `E2E_VIDEO` to a video that plays from that
machine to test the engine itself.

## Known limits

- Music analysis was tested on synthetic audio, not on real songs. The analyser's beat grid ran about
  30 ms late on test drums; both songs in a blend share the bias, so it cancels out.
- A song whose tempo drifts (live drums, old Bollywood) slides off a fixed grid; cuts work best there.
- Energy and fame values in the starter library are estimates, and its timing fields are empty until
  you tap them or run the analyser.
- YouTube can block a video in some countries; add backup IDs in the curator.

## Licences

Code: MIT (see `LICENSE`). Main libraries: React (MIT), Vite (MIT), Signalsmith Stretch (MIT),
Butterchurn and presets (MIT), web-audio-beat-detector (MIT), librosa (ISC), pyloudnorm (MIT),
mutagen (GPL-2.0, analyser only). Optional analyser backends: Beat This (MIT), Essentia (AGPL-3.0),
All-In-One (MIT), audio-separator (MIT); check their model licences before any commercial use.
