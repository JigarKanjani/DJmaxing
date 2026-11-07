"""Key detection and Camelot conversion.

Core backend: Krumhansl-Schmuckler key finding. The time-averaged chroma vector of the
harmonic part of the signal is correlated with the Krumhansl-Kessler major and minor
key profiles rotated to all 12 tonics; the best of the 24 correlations wins.

Full backend: Essentia `KeyExtractor(profileType='edma')`, whose profiles were tuned
on electronic dance music.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

log = logging.getLogger(__name__)

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLATS = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E",
          "E#": "F", "B#": "C"}

# Krumhansl-Kessler probe tone profiles, index 0 = tonic.
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass
class KeyResult:
    tonic: int  # pitch class 0 = C
    mode: str  # "major" or "minor"
    confidence: float
    backend: str

    @property
    def camelot(self) -> str:
        return to_camelot(self.tonic, self.mode)

    @property
    def name(self) -> str:
        return f"{PITCH_CLASSES[self.tonic]} {self.mode}"


def pitch_class(name: str) -> int:
    """Parse a note name such as 'A', 'Bb' or 'F#' to a pitch class (C = 0)."""
    n = name.strip()
    n = n[0].upper() + n[1:]
    n = _FLATS.get(n, n)
    return PITCH_CLASSES.index(n)


def to_camelot(tonic: int, mode: str) -> str:
    """Convert a key to Camelot notation (A = minor, B = major).

    Camelot numbers walk the circle of fifths: each step up a fifth (+7 semitones)
    adds one. C major is 8B, so a major key's number is (7 * pc) mod 12 shifted so that
    pc 0 lands on 8. A minor key shares its number with its relative major, which sits
    three semitones above the minor tonic (A minor and C major are both 8).
    """
    mode = mode.lower()
    if mode not in ("major", "minor"):
        raise ValueError(f"unknown mode {mode!r}")
    major_pc = tonic % 12 if mode == "major" else (tonic + 3) % 12
    number = (7 * major_pc + 7) % 12 + 1
    return f"{number}{'B' if mode == 'major' else 'A'}"


def key_from_chroma(chroma_mean: np.ndarray) -> tuple[int, str, float]:
    """Krumhansl-Schmuckler: correlate a 12-bin chroma vector against 24 key profiles.

    Returns (tonic pitch class, mode, best correlation).
    """
    v = np.asarray(chroma_mean, dtype=float)
    if v.shape != (12,) or not np.isfinite(v).all() or np.allclose(v, v[0]):
        raise ValueError("chroma vector is flat or invalid")
    best = (-2.0, 0, "major")
    for mode, profile in (("major", KK_MAJOR), ("minor", KK_MINOR)):
        for tonic in range(12):
            # Rotate the profile so that index `tonic` holds the profile's tonic weight.
            r = float(np.corrcoef(v, np.roll(profile, tonic))[0, 1])
            if r > best[0]:
                best = (r, tonic, mode)
    return best[1], best[2], best[0]


def _key_core(y: np.ndarray, sr: int) -> KeyResult | None:
    import librosa

    if y.size < sr * 2:
        return None
    # Drums smear chroma; keep the harmonic component only.
    y_h = librosa.effects.harmonic(y, margin=2.0)
    chroma = librosa.feature.chroma_cqt(y=y_h, sr=sr, hop_length=2048)
    # Weight frames by their energy so near-silent frames do not vote.
    weights = chroma.sum(axis=0)
    if weights.sum() <= 0:
        return None
    mean = (chroma * weights).sum(axis=1) / weights.sum()
    try:
        tonic, mode, r = key_from_chroma(mean)
    except ValueError:
        return None
    return KeyResult(tonic, mode, round(r, 3), "krumhansl-schmuckler (librosa chroma_cqt)")


def _key_essentia(y44: np.ndarray, sr: int) -> KeyResult | None:
    # API checked against https://essentia.upf.edu/reference/std_KeyExtractor.html:
    # KeyExtractor(profileType=..., sampleRate=...)(audio) -> (key, scale, strength).
    from essentia.standard import KeyExtractor  # type: ignore[import-not-found]

    key, scale, strength = KeyExtractor(profileType="edma", sampleRate=float(sr))(
        np.ascontiguousarray(y44, dtype=np.float32)
    )
    if not key or scale not in ("major", "minor"):
        return None
    return KeyResult(pitch_class(key), scale, round(float(strength), 3), "essentia KeyExtractor(edma)")


def estimate_key(y: np.ndarray, sr: int, y44: np.ndarray | None = None, sr44: int = 44100,
                 use_essentia: bool = False) -> KeyResult | None:
    if use_essentia and y44 is not None:
        try:
            res = _key_essentia(y44, sr44)
            if res is not None:
                return res
        except ImportError:
            log.info("essentia not installed, falling back to core key detection")
        except Exception as exc:  # noqa: BLE001
            log.warning("essentia key detection failed (%s), falling back to core", exc)
    return _key_core(y, sr)
