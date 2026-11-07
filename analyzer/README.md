# DJmaxing analyser

Offline analyser for your own music files. It reads a folder of audio or video files and
writes a library JSON in the format described in [`docs/library-format.md`](../docs/library-format.md),
ready to import into the DJmaxing curator.

## Install

Python 3.10 or newer (tested with 3.13). From this folder:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-core.txt
```

`ffmpeg` on your PATH is recommended. WAV, FLAC, OGG and MP3 decode through libsndfile.
M4A, AAC and video files (MP4, MKV, WEBM, MOV) need `ffmpeg`.

## Use

```sh
python -m djmax_analyze ~/Music/party -o library.local.json
python -m djmax_analyze ~/Music/party -o library.local.json --tier full --jobs 2
python -m djmax_analyze a.mp3 b.flac -o library.local.json --root ~/Music
```

| Option | Meaning |
|---|---|
| `INPUT ...` | Folders (searched recursively) and/or files. |
| `-o, --output` | Library file to write. If it exists, results are merged into it by `id`. |
| `--tier core\|full` | `full` tries the optional backends below and falls back to core for anything missing. Default `core`. |
| `--no-stems` | In the full tier, skip vocal separation (the slowest step). |
| `--jobs N` | Worker processes. Each worker loads its own models in the full tier, so keep it low there. |
| `--root DIR` | Folder that `media.file` is relative to. Default: the single input folder, or the common parent of the inputs. Use the same folder you pick in the app. |
| `-v` | Debug logging. |

The run logs which backend produced each value, and the same summary goes into
`analysis.notes` of every song.

Exit code 0 means every file was analysed, 2 means some files failed (the rest are still written).

## What it writes

For each file: `id`, `title`, `artist`, `language`, `moods`, `year`, `energy`, `fame`, `bpm`,
`camelot`, `beatGrid`, `hook`, `vocals`, `loudnessLufs`, `durationSec`, `media`
(`file` relative to the root, `youtube: []`, `spotifyUri: null`) and
`analysis: {source: "analyzer", verified: false}`.

### Metadata

* Title, artist and year from tags (mutagen). Without tags the file name is parsed as
  `Artist - Title`; otherwise the file name is the title and the artist is `Unknown Artist`.
* `id` is the ASCII slug of `title artist`, for example `kala-chashma-badshah`. Titles in a
  script without an ASCII form fall back to the file name. Two files with the same id in
  one run get `-2`, `-3` suffixes.
* `language` is `other` and `moods` is `["party"]` unless the genre tag gives a clear hint
  (for example `Bollywood` gives `hindi`, `Bhangra` gives `punjabi` and `bhangra`). `fame` is 2.
  These are for the curator to correct.

### Tempo and beat grid

* librosa beat tracking on the onset envelope.
* **Tempo folding rule:** the tempo is moved by octaves (x2, /2) into a dance range. If one
  octave lands in 85 to 135 BPM, that one is used. Otherwise the octave within 70 to 180 BPM
  closest to that band is used (so 140 stays 140, 60 becomes 120, 175 becomes 87.5). The
  beat list is doubled or halved to match.
* **Off-beat check:** if the low band (below 150 Hz) has clearly stronger onsets halfway
  between the tracked beats than on them, the grid is moved by half a beat. Bright
  off-beat hi-hats can otherwise pull the tracker off the kicks.
* **Downbeat:** of the 4 beat phases, the one whose beats have the strongest low-frequency
  onsets and energy (kick and bass emphasis) is beat 1.
* **Steady grid:** the app places every bar from one `bpm` and one `firstDownbeat`, so the
  downbeats are fitted with a single constant-tempo line (with outlier rejection) and both
  values come from that fit. `firstDownbeat` is the first grid downbeat at or after 0 s.
  Songs with real tempo drift (live recordings) will slide off this grid.

### Key

Krumhansl-Schmuckler: the energy-weighted mean of `chroma_cqt` on the harmonic part of the
signal is correlated with the Krumhansl-Kessler major and minor profiles in all 12
transpositions, and the best of the 24 wins. The result is written in Camelot notation
(A minor = 8A, C major = 8B).

### Hook

The most repeated loud section, as a stand-in for the chorus or drop:

1. Per bar: mean chroma and mean RMS.
2. Chroma of 4 consecutive bars is stacked and a cosine affinity recurrence matrix is
   built (librosa), ignoring links within 4 bars of each bar so a loop inside one section
   does not count as a return.
3. Each window of 16 bars (8 bars for songs under 40 bars) starting on a 4-bar phrase is
   scored `mean(repetition) * mean(energy)`, with a mild preference for earlier windows.
4. `entry` is the window's first downbeat; `exit` is the downbeat 16 (or 8) bars later,
   clamped to `duration - 2 s` and snapped back to a downbeat (`null` if nothing fits).

### Loudness and energy

* `loudnessLufs`: integrated loudness (ITU-R BS.1770) with pyloudnorm, on the stereo signal
  at 44.1 kHz.
* `energy` (1 to 10) is a heuristic starting point:

  ```
  energy = round(1 + 9 * (0.35 * loud + 0.25 * density + 0.15 * bright + 0.25 * pace))
  loud    = RMS level in dBFS scaled from -30 dB (0) to -8 dB (1)
  density = onsets per second scaled from 0 (0) to 5 (1)
  bright  = mean spectral centroid scaled from 800 Hz (0) to 3000 Hz (1)
  pace    = tempo scaled from 70 BPM (0) to 128 BPM (1), 0.5 when unknown
  ```

  Each term is clipped to 0..1 and the result to 1..10.

### Vocals

`null` (unknown) in the core tier. In the full tier with audio-separator, regions are found
on the vocal stem with an RMS threshold with hysteresis (on above peak minus 25 dB, off
below peak minus 35 dB), regions under 0.5 s are dropped and gaps under 1.5 s are merged.

## Merging into an existing library

Re-running with the same `-o` file merges by `id`:

* Songs that are not in this run are kept unchanged, in their original order. New songs are appended.
* `media.youtube`, `media.spotifyUri` and notes written by a person are always kept.
* If the existing entry has `analysis.verified: true`, the curator's fields (`title`,
  `artist`, `language`, `moods`, `year`, `energy`, `fame`), the confirmed timing (`bpm`,
  `beatGrid`, `hook`) and the `analysis` block are kept. Other values (`camelot`,
  `loudnessLufs`, `durationSec`, `vocals`, `media.file`) are refreshed, and fields that were
  `null` are filled in.
* Otherwise the new analysis replaces the entry.

## Full tier

Install with `pip install -r requirements-full.txt` after installing PyTorch for your
machine. Each backend is imported lazily; when one is missing or fails, a log line says so
and the core method is used.

| Backend | Used for | API checked against | Run here |
|---|---|---|---|
| [allin1](https://github.com/mir-aidj/all-in-one) 1.1.0 (MIT) | beats, downbeats, `chorus` segment for the hook | README: `allin1.analyze(path, demix_dir=, spec_dir=, keep_byproducts=)` returning `.bpm`, `.beats`, `.downbeats`, `.segments[].start/.end/.label` | No. Needs PyTorch, NATTEN and `pip install git+https://github.com/CPJKU/madmom`, see its README. Untested. |
| [beat_this](https://github.com/CPJKU/beat_this) 1.1.0 (MIT) | beats and downbeats when allin1 is absent | README: `File2Beats(checkpoint_path="final0", device=..., dbn=False)(path)` returning `(beats, downbeats)` | Yes, CPU, torch 2.11.0. The checkpoint downloads on first use. |
| [essentia](https://essentia.upf.edu/reference/std_KeyExtractor.html) 2.1b6.dev1389 (AGPL) | key, `KeyExtractor(profileType="edma")` | reference page for KeyExtractor and Key outputs `(key, scale, strength)` | Yes. |
| [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) 0.48.0 (MIT) | vocal stem for `vocals` | README: `Separator(output_dir=, output_single_stem="Vocals")`, `load_model()`, `separate(path, {"Vocals": "vocals"})` returning output file names | No. Install with `pip install "audio-separator[cpu]"` (or `[gpu]`); it pulls its own PyTorch build, so a separate virtual environment may be easiest. Untested. |

With allin1 the hook entry is the first `chorus` segment snapped to the nearest downbeat,
and the exit 16 bars later. Neural downbeats go through the same steady-grid fit as the
core tracker.

Note from the allin1 README: different MP3 decoders can shift timing by 20 to 40 ms. For
the most precise grids, analyse WAV or FLAC.

## Tests

```sh
.venv/bin/python -m pytest -q
```

The tests synthesise music with numpy (a 120 BPM four-on-the-floor song with accented
downbeats, bass on beat 1, off-beat hats and an A minor chord progression with distinct
verse and chorus sections) and check tempo, downbeat phase, key (8A), hook placement,
loudness, schema validity and merging. They cover the core tier only.

## Limitations

* Everything here is a first guess for the curator. Real songs with long beatless intros,
  tempo changes, swing, or non-4/4 bars can get a wrong grid or downbeat; check the hook and
  grid by ear and set `analysis.verified` once confirmed.
* The hook heuristic finds loud repeated material; it can pick a post-chorus or a repeated
  instrumental instead of the sung chorus.
* Key detection on a whole-song average can confuse relative keys (for example A minor and
  C major) and does not handle key changes.
* The energy score is uncalibrated against real listening.
* Times are measured on the file as decoded. A YouTube upload of the same song may have a
  different intro, so its times will not match.
