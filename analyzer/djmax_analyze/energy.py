"""Dance-floor energy heuristic, 1 to 10.

    energy = 1 + 9 * (0.35 * loud + 0.25 * density + 0.15 * bright + 0.25 * pace)

Each term is scaled to 0..1 and clipped:

* loud    : RMS level of the whole track in dBFS, -30 dB -> 0, -8 dB -> 1
            (modern dance masters sit around -10 to -7 dB RMS).
* density : onsets per second, 0 -> 0, 5 per second -> 1 (busy drums and hats).
* bright  : mean spectral centroid, 800 Hz -> 0, 3000 Hz -> 1.
* pace    : tempo, 70 BPM -> 0, 128 BPM -> 1 (unknown tempo counts as 0.5).

The result is rounded to the nearest integer and clamped to 1..10. It is a rough
starting point for the curator, not a measurement.
"""

from __future__ import annotations

import numpy as np


def _scale(x: float, lo: float, hi: float) -> float:
    return float(np.clip((x - lo) / (hi - lo), 0.0, 1.0))


def energy_features(y: np.ndarray, sr: int) -> dict[str, float]:
    import librosa

    rms = librosa.feature.rms(y=y)[0]
    rms_db = 20.0 * np.log10(float(np.sqrt(np.mean(rms**2))) + 1e-9)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time")
    duration = max(len(y) / sr, 1e-6)
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    return {"rms_db": rms_db, "onset_rate": len(onsets) / duration, "centroid_hz": centroid}


def energy_score(rms_db: float, onset_rate: float, centroid_hz: float, bpm: float | None) -> int:
    loud = _scale(rms_db, -30.0, -8.0)
    density = _scale(onset_rate, 0.0, 5.0)
    bright = _scale(centroid_hz, 800.0, 3000.0)
    pace = 0.5 if bpm is None else _scale(bpm, 70.0, 128.0)
    raw = 1.0 + 9.0 * (0.35 * loud + 0.25 * density + 0.15 * bright + 0.25 * pace)
    return int(np.clip(round(raw), 1, 10))


def estimate_energy(y: np.ndarray, sr: int, bpm: float | None) -> int:
    f = energy_features(y, sr)
    return energy_score(f["rms_db"], f["onset_rate"], f["centroid_hz"], bpm)
