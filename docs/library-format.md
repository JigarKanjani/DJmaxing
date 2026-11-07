# Library format

Everything DJmaxing knows about a song lives in one JSON file. The app ships with
`public/library.json`, the Python analyser writes the same format, and the curator
screen in the app imports and exports it.

```json
{
  "version": 1,
  "songs": [ /* Song objects */ ]
}
```

## Song

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable slug, lowercase letters, digits and hyphens, for example `kala-chashma-badshah`. Used to merge libraries. |
| `title` | string | yes | Song title. |
| `artist` | string | yes | Main artists, comma separated. The first name is used to avoid back-to-back artists. |
| `language` | string | yes | One of `hindi`, `punjabi`, `english`, `gujarati`, `tamil`, `telugu`, `haryanvi`, `bhojpuri`, `marathi`, `bengali`, `other`. |
| `moods` | string[] | yes | Any of `dance`, `party`, `wedding`, `bhangra`, `romantic`, `sad`, `sufi`, `retro`, `gym`, `hiphop`, `garba`, `pop`, `edm`, `devotional`. At least one. |
| `year` | number or null | no | Release year. |
| `energy` | number 1 to 10 | yes | How hard the song hits on a dance floor. 1 is a slow ballad, 10 is a peak-time banger. |
| `fame` | 1, 2 or 3 | yes | 3 means everyone in the room knows it, 1 means a deep cut. |
| `bpm` | number or null | no | Tempo in beats per minute, as felt on the dance floor. |
| `camelot` | string or null | no | Key in Camelot notation, `1A` to `12B` (A is minor, B is major). |
| `beatGrid` | object or null | no | `{ "firstDownbeat": seconds, "beatsPerBar": 4 }`. The time of any bar's first beat, in the media's own timeline. With `bpm`, this places every bar and phrase. |
| `hook` | object or null | no | `{ "entry": seconds, "exit": seconds or null }`. Where play starts (usually the drop or chorus) and where it should hand over. `exit: null` plays to the end. `hook: null` means the song still needs timing, and the app starts at 30 seconds. |
| `vocals` | array or null | no | Vocal regions as `[[start, end], ...]` in seconds. Used to avoid two vocals overlapping. |
| `loudnessLufs` | number or null | no | Integrated loudness in LUFS. Used to level songs against each other. |
| `durationSec` | number or null | no | Length of the media in seconds. |
| `media` | object | yes | Where to play it from, see below. |
| `analysis` | object | yes | Where the timing data came from, see below. |

### media

| Field | Type | Meaning |
|---|---|---|
| `youtube` | string[] | YouTube video IDs (11 characters), best first. Later IDs are fallbacks when one is blocked in a region. |
| `file` | string or null | Path of a local audio or video file, relative to the folder you pick in the app. |
| `spotifyUri` | string or null | `spotify:track:...` when known. The Spotify export looks songs up by title and artist when this is empty. |

### analysis

| Field | Type | Meaning |
|---|---|---|
| `source` | string | `analyzer` (the Python analyser), `tap` (tapped in the curator), `manual`, or `estimate` (a human guess, not measured). |
| `verified` | boolean | True once someone has listened and confirmed the hook and beat grid. |
| `notes` | string | Optional free text. |

## Rules the app relies on

- Times always refer to the media the times were measured on. A YouTube video often has an intro
  that the audio file does not, so a song played from both needs two entries or retiming.
- If `bpm` and `beatGrid` are present, `hook.entry` and `hook.exit` should sit on a downbeat.
  The app snaps them to the nearest downbeat anyway.
- Unknown values are `null`, never guessed numbers. The set builder treats a missing tempo or key
  as neutral and falls back to a short fade.
