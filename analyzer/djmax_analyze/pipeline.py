"""Analyse one file into a Song dict (docs/library-format.md)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .audio import load_audio
from .energy import estimate_energy
from .key import estimate_key
from .loudness import integrated_lufs
from .metadata import read_metadata, song_id
from .structure import find_hook
from .tempo import BEATS_PER_BAR, track_beats
from .vocals import detect_vocals

log = logging.getLogger(__name__)


def analyse_file(path: Path, rel_path: str, tier: str = "core", stems: bool = True) -> dict[str, Any]:
    full = tier == "full"
    audio = load_audio(path)
    y, sr = audio.mono, audio.sr
    duration = audio.duration
    notes: list[str] = []

    beats = track_beats(y, sr, path=path, full=full)
    notes.append(f"beats: {beats.backend}")
    bpm = round(beats.bpm, 1) if beats.bpm else None
    beat_grid = None
    hook_obj = None
    if bpm is not None and beats.first_downbeat is not None:
        beat_grid = {"firstDownbeat": round(beats.first_downbeat, 3), "beatsPerBar": BEATS_PER_BAR}
        hook = find_hook(y, sr, beats.downbeats, duration, beats.segments or None)
        if hook is not None:
            hook_obj = {"entry": round(hook.entry, 3), "exit": None if hook.exit is None else round(hook.exit, 3)}
            notes.append(f"hook: {hook.method}")

    key = estimate_key(y, sr, y44=audio.full.mean(axis=1), sr44=audio.full_sr, use_essentia=full)
    if key is not None:
        notes.append(f"key: {key.name} via {key.backend}")

    vocals = detect_vocals(path) if (full and stems) else None
    if vocals is not None:
        notes.append("vocals: audio-separator")

    meta = read_metadata(path)
    log.info(
        "%s: %s BPM, key %s, hook %s (%s)",
        rel_path, bpm, key.camelot if key else None,
        hook_obj["entry"] if hook_obj else None, "; ".join(notes),
    )
    return {
        "id": song_id(meta.title, meta.artist, fallback=Path(rel_path).stem),
        "title": meta.title,
        "artist": meta.artist,
        "language": meta.language,
        "moods": meta.moods,
        "year": meta.year,
        "energy": estimate_energy(y, sr, beats.bpm),
        "fame": 2,
        "bpm": bpm,
        "camelot": key.camelot if key else None,
        "beatGrid": beat_grid,
        "hook": hook_obj,
        "vocals": vocals,
        "loudnessLufs": integrated_lufs(audio.full, audio.full_sr),
        "durationSec": round(duration, 2),
        "media": {"youtube": [], "file": rel_path, "spotifyUri": None},
        "analysis": {"source": "analyzer", "verified": False, "notes": "; ".join(notes)},
    }
