"""Tempo, beats and downbeats.

Core backend: librosa dynamic-programming beat tracker, then

* tempo folding into a dance range (see `fold_tempo`), adjusting the beat list to match,
* an off-beat check that moves the grid onto the kicks (see `fix_offbeat`),
* downbeat phase by kick emphasis (see `downbeat_phase`).

Every backend ends with `fit_bar_grid`: the app describes all bars with one `bpm` and
one `firstDownbeat`, so the downbeats are fitted with a single steady grid and the
reported tempo comes from that fit.

Full backends (optional, tried in this order):

* allin1 (mir-aidj/all-in-one): `allin1.analyze(path)` returns bpm, beats, downbeats
  and labelled segments. Its result is cached on the BeatResult so structure.py can use
  the chorus labels.
* beat_this (CPJKU/beat_this): `File2Beats(checkpoint_path="final0", device=..., dbn=False)`
  called with a path returns `(beats, downbeats)` in seconds.
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

BPM_MIN, BPM_MAX = 70.0, 180.0
BPM_PREF_MIN, BPM_PREF_MAX = 85.0, 135.0
BEATS_PER_BAR = 4


@dataclass
class Segment:
    start: float
    end: float
    label: str


@dataclass
class BeatResult:
    bpm: float | None
    beats: np.ndarray
    downbeats: np.ndarray
    backend: str
    segments: list[Segment] = field(default_factory=list)

    @property
    def first_downbeat(self) -> float | None:
        return float(self.downbeats[0]) if self.downbeats.size else None


def fold_tempo(bpm: float) -> tuple[float, float]:
    """Fold a tempo into the dance range by octaves.

    Rule: consider bpm * 2**k for k in -3..3. If one candidate lies in the preferred
    band 85 to 135 BPM, use it (the band is narrower than an octave, so there is at most
    one). Otherwise use the candidate in 70 to 180 BPM that is closest to the preferred
    band (for example 140 stays 140 because 70 is further from the band). Returns
    (folded bpm, factor) with folded = bpm * factor.
    """
    if not np.isfinite(bpm) or bpm <= 0:
        raise ValueError("tempo must be positive")
    cands = [(bpm * 2.0**k, 2.0**k) for k in range(-3, 4)]
    for c, f in cands:
        if BPM_PREF_MIN <= c <= BPM_PREF_MAX:
            return c, f
    in_range = [(c, f) for c, f in cands if BPM_MIN <= c <= BPM_MAX]
    if not in_range:  # cannot happen for a 70..180 window, kept for safety
        return bpm, 1.0

    def dist(c: float) -> float:
        return BPM_PREF_MIN - c if c < BPM_PREF_MIN else c - BPM_PREF_MAX

    return min(in_range, key=lambda cf: dist(cf[0]))


def bpm_from_beats(beats: np.ndarray) -> float | None:
    if beats.size < 4:
        return None
    ibi = np.diff(beats)
    med = float(np.median(ibi))
    # Average only intervals near the median, so a dropped beat does not bias the tempo.
    good = ibi[np.abs(ibi - med) < 0.15 * med]
    return 60.0 / float(good.mean() if good.size else med)


def _strength_at(env: np.ndarray, times: np.ndarray, sr: int, hop: int, radius: int = 2) -> np.ndarray:
    """Max of a frame envelope within +-radius frames of each time."""
    frames = np.round(times * sr / hop).astype(int)
    out = np.zeros(len(frames))
    for i, f in enumerate(frames):
        lo, hi = max(0, f - radius), min(len(env), f + radius + 1)
        out[i] = env[lo:hi].max() if hi > lo else 0.0
    return out


def low_band_features(y: np.ndarray, sr: int, hop: int = 512) -> tuple[np.ndarray, np.ndarray]:
    """Low-frequency (below ~150 Hz) onset strength and energy envelopes.

    Kick drums and bass notes live here; in most dance music the strongest kick and
    the bass note change land on beat 1 of the bar.
    """
    import librosa

    S = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=hop, n_mels=128, fmax=sr / 2)
    freqs = librosa.mel_frequencies(n_mels=128, fmin=0.0, fmax=sr / 2)
    low = freqs < 150.0
    S_low = S[low]
    onset = librosa.onset.onset_strength(S=librosa.power_to_db(S_low, ref=np.max), sr=sr)
    energy = np.sqrt(S_low.sum(axis=0))
    return onset, energy


def fix_offbeat(beats: np.ndarray, y: np.ndarray, sr: int, hop: int = 512) -> np.ndarray:
    """Move the beat grid by half a beat when it sits on the off-beats.

    Bright off-beat hi-hats can pull the tracker half a beat away from the kicks. Dance
    music puts the kick on the beat, so if the low band has clearly stronger onsets
    halfway between the tracked beats than on them (ratio above 1.3), the grid is
    shifted to those midpoints.
    """
    if beats.size < 8:
        return beats
    onset, _ = low_band_features(y, sr, hop)
    mids = (beats[:-1] + beats[1:]) / 2.0
    on_beat = _strength_at(onset, beats, sr, hop).mean()
    off_beat = _strength_at(onset, mids, sr, hop).mean()
    if off_beat > 1.3 * on_beat:
        log.debug("beat grid was on the off-beats (low-band onset ratio %.2f), shifting", off_beat / (on_beat or 1e-9))
        # Keep the beat count: extrapolate one half beat after the last midpoint.
        return np.append(mids, mids[-1] + float(np.median(np.diff(beats))))
    return beats


def downbeat_phase(beats: np.ndarray, y: np.ndarray, sr: int, hop: int = 512) -> int:
    """Pick which of the 4 beat phases is beat 1.

    Score each beat by low-band onset strength plus half the low-band energy (both
    normalised), then average per phase (beats p, p+4, p+8, ...). The phase with the
    strongest kick and bass emphasis is taken as the downbeat.
    """
    if beats.size < BEATS_PER_BAR:
        return 0
    onset, energy = low_band_features(y, sr, hop)
    s_on = _strength_at(onset, beats, sr, hop)
    s_en = _strength_at(energy, beats, sr, hop)
    s_on = s_on / (s_on.max() or 1.0)
    s_en = s_en / (s_en.max() or 1.0)
    score = s_on + 0.5 * s_en
    phase_scores = [score[p::BEATS_PER_BAR].mean() for p in range(BEATS_PER_BAR)]
    return int(np.argmax(phase_scores))


def _rescale_beats(beats: np.ndarray, factor: float, onset_env: np.ndarray, sr: int, hop: int) -> np.ndarray:
    """Apply an octave tempo factor to a beat list (2 = insert midpoints, 0.5 = drop half)."""
    while factor >= 2.0 and beats.size >= 2:
        mids = (beats[:-1] + beats[1:]) / 2.0
        beats = np.sort(np.concatenate([beats, mids]))
        factor /= 2.0
    while factor <= 0.5 and beats.size >= 2:
        # Keep the half (even or odd beats) with the stronger onsets.
        s = _strength_at(onset_env, beats, sr, hop)
        phase = 0 if s[0::2].sum() >= s[1::2].sum() else 1
        beats = beats[phase::2]
        factor *= 2.0
    return beats


def _beats_librosa(y: np.ndarray, sr: int) -> BeatResult:
    import librosa

    hop = 512
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    _, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=hop)
    beats = librosa.frames_to_time(np.asarray(beat_frames), sr=sr, hop_length=hop)
    raw = bpm_from_beats(beats)
    if raw is None:
        return BeatResult(None, beats, np.array([]), "librosa")
    _, factor = fold_tempo(raw)
    if factor != 1.0:
        log.debug("folding tempo %.1f by x%g", raw, factor)
        beats = _rescale_beats(beats, factor, onset_env, sr, hop)
    beats = fix_offbeat(beats, y, sr, hop)
    phase = downbeat_phase(beats, y, sr, hop)
    return _grid_result(beats, beats[phase::BEATS_PER_BAR], len(y) / sr,
                        "librosa beat_track + kick-emphasis downbeat")


def _grid_result(beats: np.ndarray, downbeats: np.ndarray, duration: float, backend: str,
                 segments: list[Segment] | None = None, fold: bool = False) -> BeatResult:
    """Fit the steady bar grid and derive the reported tempo from it."""
    ibi_bpm = bpm_from_beats(beats)
    if ibi_bpm is None:
        return BeatResult(None, beats, np.array([]), backend, segments or [])
    fit = fit_bar_grid(downbeats, BEATS_PER_BAR * 60.0 / ibi_bpm)
    if fit is None:
        return BeatResult(None, beats, np.array([]), backend, segments or [])
    first, bar = fit
    bpm = BEATS_PER_BAR * 60.0 / bar
    if fold:
        bpm = _model_bpm(bpm, backend) or bpm
    return BeatResult(bpm, beats, grid_times(first, bar, duration), backend, segments or [])


def fit_bar_grid(downbeats: np.ndarray, bar_guess: float, tol: float = 0.07) -> tuple[float, float] | None:
    """Fit one constant-tempo bar grid t = first + n * bar to observed downbeats.

    The app places every bar from just `bpm` and `firstDownbeat`, so the output must be
    a single steady grid. Bar numbers are assigned by walking the downbeats and rounding
    each gap to whole bars (local gaps are short, so rounding is reliable even when the
    tempo guess is slightly off). A least squares line through (bar number, time) is then
    refitted a few times without the points that miss it by more than `tol` seconds,
    which drops bars where a tracker briefly flipped phase (for example a drum-only
    intro tracked on the off-beats).

    Returns (first downbeat at or after 0 s, bar length in seconds), or None.
    """
    d = np.sort(np.asarray(downbeats, dtype=float))
    if d.size < 3 or bar_guess <= 0:
        return None
    k = np.zeros(d.size)
    for i in range(1, d.size):
        k[i] = k[i - 1] + max(0, round((d[i] - d[i - 1]) / bar_guess))
    mask = np.ones(d.size, dtype=bool)
    # Start from the median line, robust to a minority of flipped bars.
    bar = bar_guess
    offset = float(np.median(d - k * bar))
    for _ in range(5):
        resid = np.abs(d - (offset + k * bar))
        new_mask = resid <= max(tol, 0.5 * np.median(resid))
        if new_mask.sum() < 3:
            break
        mask = new_mask
        bar, offset = np.polyfit(k[mask], d[mask], 1)
        bar, offset = float(bar), float(offset)
    if bar <= 0:
        return None
    return offset % bar, bar


def grid_times(first: float, bar: float, duration: float) -> np.ndarray:
    n = int(max(0.0, duration - first) // bar) + 1
    return first + bar * np.arange(n)


def _model_bpm(bpm: float | None, name: str) -> float | None:
    """Tempo reported for a neural tracker's beats.

    The models track downbeats themselves, so their beat level is trusted inside
    70 to 180 BPM (no preference-band folding, which would put the app's bar grid out of
    step with the model's downbeats). Outside that range the tempo is folded and a note
    is logged; the downbeats stay as the model gave them.
    """
    if bpm is None or BPM_MIN <= bpm <= BPM_MAX:
        return bpm
    folded = fold_tempo(bpm)[0]
    log.info("%s tempo %.1f outside %g-%g BPM, reporting %.1f", name, bpm, BPM_MIN, BPM_MAX, folded)
    return folded


def _beats_allin1(path: Path, duration: float) -> BeatResult:
    # API checked against the mir-aidj/all-in-one README:
    # allin1.analyze(path, demix_dir=..., spec_dir=..., keep_byproducts=False) -> AnalysisResult
    # with .bpm, .beats, .downbeats and .segments (Segment(start, end, label)).
    import allin1  # type: ignore[import-not-found]

    with tempfile.TemporaryDirectory(prefix="djmax-allin1-") as tmp:
        res: Any = allin1.analyze(
            str(path),
            demix_dir=str(Path(tmp) / "demix"),
            spec_dir=str(Path(tmp) / "spec"),
            keep_byproducts=False,
        )
    segs = [Segment(float(s.start), float(s.end), str(s.label)) for s in res.segments]
    return _grid_result(np.asarray(res.beats, dtype=float), np.asarray(res.downbeats, dtype=float),
                        duration, "allin1", segs, fold=True)


_BEAT_THIS_MODEL: Any = None


def _beats_beat_this(path: Path, duration: float) -> BeatResult:
    # API checked against the CPJKU/beat_this README:
    # File2Beats(checkpoint_path="final0", device="cuda", dbn=False)(audio_path) -> (beats, downbeats)
    global _BEAT_THIS_MODEL
    from beat_this.inference import File2Beats  # type: ignore[import-not-found]

    if _BEAT_THIS_MODEL is None:
        import torch  # type: ignore[import-not-found]

        device = "cuda" if torch.cuda.is_available() else "cpu"
        _BEAT_THIS_MODEL = File2Beats(checkpoint_path="final0", device=device, dbn=False)
    beats, downbeats = _BEAT_THIS_MODEL(str(path))
    return _grid_result(np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float),
                        duration, "beat_this", fold=True)


def track_beats(y: np.ndarray, sr: int, path: Path | None = None, full: bool = False) -> BeatResult:
    """Run the best available beat tracker. `full` enables the optional backends."""
    if full and path is not None:
        for name, fn in (("allin1", _beats_allin1), ("beat_this", _beats_beat_this)):
            try:
                res = fn(path, len(y) / sr)
                if res.downbeats.size:
                    return res
                log.warning("%s returned no downbeats, trying next backend", name)
            except ImportError:
                log.info("%s not installed, skipping", name)
            except Exception as exc:  # noqa: BLE001
                log.warning("%s failed on %s (%s), trying next backend", name, path.name, exc)
    return _beats_librosa(y, sr)
