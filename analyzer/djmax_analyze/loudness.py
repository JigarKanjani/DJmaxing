"""Integrated loudness (ITU-R BS.1770 / EBU R128) via pyloudnorm."""

from __future__ import annotations

import math

import numpy as np


def integrated_lufs(data: np.ndarray, sr: int) -> float | None:
    """Integrated loudness in LUFS, rounded to 0.1, or None for silence or very short audio.

    `data` is (samples,) or (samples, channels) float audio.
    """
    import pyloudnorm as pyln

    if data.shape[0] < int(0.4 * sr):  # BS.1770 gating needs at least one 400 ms block
        return None
    meter = pyln.Meter(sr)
    value = float(meter.integrated_loudness(np.asarray(data, dtype=np.float64)))
    if not math.isfinite(value):
        return None
    return round(value, 1)
