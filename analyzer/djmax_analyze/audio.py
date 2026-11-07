"""Audio decoding.

Decoding order: soundfile (libsndfile handles WAV, FLAC, OGG, MP3 and more), then the
`ffmpeg` command line tool if it is on PATH (needed for M4A, AAC and video containers).
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wma",
    ".aif", ".aiff", ".alac",
}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi"}
MEDIA_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS

#: Sample rate used for loudness (pyloudnorm) and for optional backends.
FULL_SR = 44100
#: Sample rate used for librosa analysis.
ANALYSIS_SR = 22050


@dataclass
class Audio:
    path: Path
    #: Stereo (or mono) audio at FULL_SR, shape (samples, channels), float32.
    full: np.ndarray
    #: Mono audio at ANALYSIS_SR, float32.
    mono: np.ndarray
    sr: int = ANALYSIS_SR
    full_sr: int = FULL_SR

    @property
    def duration(self) -> float:
        return float(self.full.shape[0]) / self.full_sr


class DecodeError(RuntimeError):
    pass


def _decode_soundfile(path: Path) -> tuple[np.ndarray, int]:
    import soundfile as sf

    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return data, int(sr)


def _decode_ffmpeg(path: Path, sr: int) -> tuple[np.ndarray, int]:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise DecodeError("ffmpeg not found on PATH")
    cmd = [
        exe, "-v", "error", "-nostdin", "-i", str(path),
        "-vn", "-ac", "2", "-ar", str(sr), "-f", "f32le", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0 or not proc.stdout:
        raise DecodeError(proc.stderr.decode("utf-8", "replace").strip() or "ffmpeg failed")
    data = np.frombuffer(proc.stdout, dtype=np.float32).reshape(-1, 2)
    return data.copy(), sr


def load_audio(path: str | Path) -> Audio:
    """Decode a media file into full-rate stereo and analysis-rate mono arrays."""
    import librosa

    path = Path(path)
    data: np.ndarray | None = None
    sr = 0
    errors: list[str] = []
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        try:
            data, sr = _decode_soundfile(path)
            log.debug("decoded %s with soundfile", path.name)
        except Exception as exc:  # noqa: BLE001 (any decoder failure means try the next one)
            errors.append(f"soundfile: {exc}")
    if data is None:
        try:
            data, sr = _decode_ffmpeg(path, FULL_SR)
            log.debug("decoded %s with ffmpeg", path.name)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"ffmpeg: {exc}")
    if data is None or data.size == 0:
        raise DecodeError(f"could not decode {path}: " + "; ".join(errors))

    if sr != FULL_SR:
        data = librosa.resample(data.T, orig_sr=sr, target_sr=FULL_SR).T
    data = np.ascontiguousarray(data, dtype=np.float32)
    mono_full = data.mean(axis=1)
    mono = librosa.resample(mono_full, orig_sr=FULL_SR, target_sr=ANALYSIS_SR).astype(np.float32)
    return Audio(path=path, full=data, mono=mono)
