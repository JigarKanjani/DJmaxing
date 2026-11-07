"""Validator for the library format (docs/library-format.md) and the merge logic."""

from __future__ import annotations

import copy
import json
import math
import re
from pathlib import Path
from typing import Any

LIBRARY_VERSION = 1

LANGUAGES = {
    "hindi", "punjabi", "english", "gujarati", "tamil", "telugu", "haryanvi",
    "bhojpuri", "marathi", "bengali", "other",
}
MOODS = {
    "dance", "party", "wedding", "bhangra", "romantic", "sad", "sufi", "retro", "gym",
    "hiphop", "garba", "pop", "edm", "devotional",
}
SOURCES = {"analyzer", "tap", "manual", "estimate"}

_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_CAMELOT_RE = re.compile(r"^(?:[1-9]|1[0-2])[AB]$")
_YOUTUBE_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

#: Fields a curator sets by ear. Kept from the existing entry when it is verified.
MANUAL_FIELDS = ("title", "artist", "language", "moods", "year", "energy", "fame")
#: Timing fields a verified entry has had confirmed by a listener.
TIMING_FIELDS = ("bpm", "beatGrid", "hook")


def _num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def validate_song(song: Any) -> list[str]:
    """Return a list of problems with one Song object (empty when valid)."""
    errs: list[str] = []
    if not isinstance(song, dict):
        return ["song is not an object"]
    sid = song.get("id")
    p = f"song {sid!r}: "
    if not isinstance(sid, str) or not _ID_RE.match(sid):
        errs.append(p + "id must be a lowercase slug of letters, digits and hyphens")
    for key in ("title", "artist"):
        if not isinstance(song.get(key), str) or not song[key].strip():
            errs.append(p + f"{key} must be a non-empty string")
    if song.get("language") not in LANGUAGES:
        errs.append(p + f"language {song.get('language')!r} is not allowed")
    moods = song.get("moods")
    if not isinstance(moods, list) or not moods or any(m not in MOODS for m in moods):
        errs.append(p + "moods must be a non-empty list of allowed moods")
    year = song.get("year")
    if year is not None and not (isinstance(year, int) and not isinstance(year, bool)):
        errs.append(p + "year must be an integer or null")
    energy = song.get("energy")
    if not _num(energy) or not 1 <= energy <= 10:
        errs.append(p + "energy must be a number from 1 to 10")
    if song.get("fame") not in (1, 2, 3) or isinstance(song.get("fame"), bool):
        errs.append(p + "fame must be 1, 2 or 3")
    bpm = song.get("bpm")
    if bpm is not None and (not _num(bpm) or bpm <= 0):
        errs.append(p + "bpm must be a positive number or null")
    cam = song.get("camelot")
    if cam is not None and (not isinstance(cam, str) or not _CAMELOT_RE.match(cam)):
        errs.append(p + "camelot must look like 8A or 12B, or be null")
    grid = song.get("beatGrid")
    if grid is not None:
        if not isinstance(grid, dict) or not _num(grid.get("firstDownbeat")) or grid["firstDownbeat"] < 0:
            errs.append(p + "beatGrid.firstDownbeat must be a non-negative number")
        elif not (isinstance(grid.get("beatsPerBar"), int) and not isinstance(grid["beatsPerBar"], bool)
                  and grid["beatsPerBar"] > 0):
            errs.append(p + "beatGrid.beatsPerBar must be a positive integer")
    hook = song.get("hook")
    if hook is not None:
        if not isinstance(hook, dict) or not _num(hook.get("entry")) or hook["entry"] < 0:
            errs.append(p + "hook.entry must be a non-negative number")
        elif "exit" not in hook or (hook["exit"] is not None and (not _num(hook["exit"]) or hook["exit"] <= hook["entry"])):
            errs.append(p + "hook.exit must be null or a number after hook.entry")
    vocals = song.get("vocals")
    if vocals is not None:
        ok = isinstance(vocals, list) and all(
            isinstance(r, list) and len(r) == 2 and _num(r[0]) and _num(r[1]) and r[0] <= r[1] for r in vocals
        )
        if not ok:
            errs.append(p + "vocals must be null or a list of [start, end] pairs")
    for key in ("loudnessLufs",):
        if song.get(key) is not None and not _num(song[key]):
            errs.append(p + f"{key} must be a number or null")
    dur = song.get("durationSec")
    if dur is not None and (not _num(dur) or dur <= 0):
        errs.append(p + "durationSec must be a positive number or null")
    media = song.get("media")
    if not isinstance(media, dict):
        errs.append(p + "media must be an object")
    else:
        yt = media.get("youtube")
        if not isinstance(yt, list) or any(not isinstance(v, str) or not _YOUTUBE_RE.match(v) for v in yt):
            errs.append(p + "media.youtube must be a list of 11 character video IDs")
        if media.get("file") is not None and not isinstance(media["file"], str):
            errs.append(p + "media.file must be a string or null")
        su = media.get("spotifyUri")
        if su is not None and (not isinstance(su, str) or not su.startswith("spotify:track:")):
            errs.append(p + "media.spotifyUri must be spotify:track:... or null")
    analysis = song.get("analysis")
    if not isinstance(analysis, dict):
        errs.append(p + "analysis must be an object")
    else:
        if analysis.get("source") not in SOURCES:
            errs.append(p + f"analysis.source must be one of {sorted(SOURCES)}")
        if not isinstance(analysis.get("verified"), bool):
            errs.append(p + "analysis.verified must be a boolean")
        if "notes" in analysis and not isinstance(analysis["notes"], str):
            errs.append(p + "analysis.notes must be a string")
    return errs


def validate_library(lib: Any) -> list[str]:
    if not isinstance(lib, dict):
        return ["library is not an object"]
    errs: list[str] = []
    if lib.get("version") != LIBRARY_VERSION:
        errs.append(f"version must be {LIBRARY_VERSION}")
    songs = lib.get("songs")
    if not isinstance(songs, list):
        return errs + ["songs must be a list"]
    seen: set[str] = set()
    for s in songs:
        errs.extend(validate_song(s))
        sid = s.get("id") if isinstance(s, dict) else None
        if isinstance(sid, str):
            if sid in seen:
                errs.append(f"duplicate id {sid!r}")
            seen.add(sid)
    return errs


def merge_song(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """Merge a fresh analyser result into an existing entry with the same id.

    * Always kept from the existing entry: media.youtube and media.spotifyUri (the
      analyser does not know them), and analysis.notes written by a person (source other
      than "analyzer").
    * Existing entry verified: manual fields (title, artist, language, moods, year,
      energy, fame) and the listener-confirmed timing (bpm, beatGrid, hook) are kept,
      and so is the analysis block. Other measured fields are refreshed, and null values
      in the existing entry are filled from the new analysis.
    * Existing entry not verified: the new analysis replaces it.
    """
    merged = copy.deepcopy(new)
    old_media = old.get("media") or {}
    merged["media"]["youtube"] = list(old_media.get("youtube") or [])
    merged["media"]["spotifyUri"] = old_media.get("spotifyUri")
    old_analysis = old.get("analysis") or {}
    if old_analysis.get("notes") and old_analysis.get("source") != "analyzer":
        merged["analysis"]["notes"] = old_analysis["notes"]
    if old_analysis.get("verified") is True:
        for key in MANUAL_FIELDS + TIMING_FIELDS:
            if key in old and old[key] is not None:
                merged[key] = copy.deepcopy(old[key])
        merged["analysis"] = copy.deepcopy(old_analysis)
    return merged


def merge_libraries(existing: dict[str, Any] | None, new_songs: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge by id. Existing order is kept, new ids are appended, untouched entries stay."""
    songs: list[dict[str, Any]] = list((existing or {}).get("songs") or [])
    index = {s.get("id"): i for i, s in enumerate(songs) if isinstance(s, dict)}
    for song in new_songs:
        i = index.get(song["id"])
        if i is None:
            index[song["id"]] = len(songs)
            songs.append(song)
        else:
            songs[i] = merge_song(songs[i], song)
    return {"version": LIBRARY_VERSION, "songs": songs}


def load_library(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict) or not isinstance(data.get("songs"), list):
        raise ValueError(f"{path} is not a library file")
    return data


def write_library(path: Path, lib: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(lib, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    tmp.replace(path)
