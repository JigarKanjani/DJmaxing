"""Vocal regions (full tier only).

The vocal stem comes from audio-separator (nomadkaraoke/python-audio-separator). API
checked against its README:

    from audio_separator.separator import Separator
    separator = Separator(output_dir=..., output_single_stem="Vocals")
    separator.load_model()                      # default model, downloaded on first use
    output_files = separator.separate(path, {"Vocals": "vocals"})

Regions are found on the stem with an RMS threshold with hysteresis: a region opens
when the level rises above (peak - 25 dB) and closes when it falls below (peak - 35 dB).
Regions shorter than 0.5 s are dropped and gaps shorter than 1.5 s are merged.

In the core tier vocals are left as null (unknown).
"""

from __future__ import annotations

import atexit
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

ON_DB_BELOW_PEAK = 25.0
OFF_DB_BELOW_PEAK = 35.0
MIN_REGION = 0.5
MERGE_GAP = 1.5

_SEPARATOR: Any = None
_STEM_DIR: Path | None = None


def vocal_regions(stem: np.ndarray, sr: int, hop: int = 1024) -> list[list[float]]:
    """Vocal activity regions [[start, end], ...] in seconds from a mono vocal stem."""
    if stem.ndim > 1:
        stem = stem.mean(axis=1)
    n = len(stem) // hop
    if n == 0:
        return []
    frames = stem[: n * hop].reshape(n, hop).astype(np.float64)
    db = 10.0 * np.log10(np.mean(frames**2, axis=1) + 1e-12)
    peak = float(np.percentile(db, 99))
    if peak < -60.0:  # essentially silent stem
        return []
    on, off = peak - ON_DB_BELOW_PEAK, peak - OFF_DB_BELOW_PEAK

    regions: list[list[float]] = []
    active, start = False, 0
    for i, level in enumerate(db):
        if not active and level >= on:
            active, start = True, i
        elif active and level < off:
            active = False
            regions.append([start * hop / sr, i * hop / sr])
    if active:
        regions.append([start * hop / sr, n * hop / sr])

    merged: list[list[float]] = []
    for r in regions:
        if merged and r[0] - merged[-1][1] < MERGE_GAP:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [[round(a, 2), round(b, 2)] for a, b in merged if b - a >= MIN_REGION]


def _get_separator() -> tuple[Any, Path]:
    """One Separator per process, writing into one private temporary folder.

    output_dir is handed to the model when load_model() runs, so the folder is created
    once and reused instead of changing it per file.
    """
    global _SEPARATOR, _STEM_DIR
    from audio_separator.separator import Separator  # type: ignore[import-not-found]

    if _SEPARATOR is None:
        _STEM_DIR = Path(tempfile.mkdtemp(prefix="djmax-stems-"))
        atexit.register(shutil.rmtree, _STEM_DIR, True)
        sep = Separator(output_dir=str(_STEM_DIR), output_single_stem="Vocals")
        sep.load_model()  # default model from the README, downloaded on first use
        _SEPARATOR = sep
        log.info("vocals backend: audio-separator (default model)")
    assert _STEM_DIR is not None
    return _SEPARATOR, _STEM_DIR


def separate_vocals(path: Path) -> tuple[np.ndarray, int] | None:
    """Run audio-separator and return the vocal stem (mono) and its sample rate."""
    import soundfile as sf

    sep, stem_dir = _get_separator()
    outputs = sep.separate(str(path), {"Vocals": "vocals"})
    files = [Path(p) if Path(p).is_absolute() else stem_dir / p for p in outputs]
    try:
        stem_path = next((p for p in files if p.exists() and "vocal" in p.name.lower()), None)
        if stem_path is None:
            log.warning("audio-separator produced no vocal stem for %s", path.name)
            return None
        data, sr = sf.read(str(stem_path), dtype="float32", always_2d=True)
        return data.mean(axis=1), int(sr)
    finally:
        for p in files:
            p.unlink(missing_ok=True)


def detect_vocals(path: Path) -> list[list[float]] | None:
    """Vocal regions via audio-separator, or None when it is unavailable or fails."""
    try:
        res = separate_vocals(path)
    except ImportError:
        log.info("audio-separator not installed, vocals left null")
        return None
    except Exception as exc:  # noqa: BLE001
        log.warning("audio-separator failed on %s (%s), vocals left null", path.name, exc)
        return None
    if res is None:
        return None
    return vocal_regions(*res)
