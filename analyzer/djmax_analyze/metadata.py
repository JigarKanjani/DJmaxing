"""Title, artist, year, language and mood hints from tags (mutagen) or the file name."""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

UNKNOWN_ARTIST = "Unknown Artist"

# Genre tag substrings -> language. Checked in order, first match wins. Deliberately
# small: a wrong language is worse than "other".
_LANGUAGE_HINTS: list[tuple[str, str]] = [
    ("bhojpuri", "bhojpuri"),
    ("haryanvi", "haryanvi"),
    ("punjabi", "punjabi"),
    ("bhangra", "punjabi"),
    ("gujarati", "gujarati"),
    ("garba", "gujarati"),
    ("marathi", "marathi"),
    ("bengali", "bengali"),
    ("tamil", "tamil"),
    ("kollywood", "tamil"),
    ("telugu", "telugu"),
    ("tollywood", "telugu"),
    ("bollywood", "hindi"),
    ("hindi", "hindi"),
]

# Genre tag substrings -> moods (all matches are collected).
_MOOD_HINTS: list[tuple[str, str]] = [
    ("bhangra", "bhangra"),
    ("garba", "garba"),
    ("sufi", "sufi"),
    ("qawwali", "sufi"),
    ("devotional", "devotional"),
    ("bhajan", "devotional"),
    ("hip hop", "hiphop"),
    ("hip-hop", "hiphop"),
    ("hiphop", "hiphop"),
    ("rap", "hiphop"),
    ("edm", "edm"),
    ("electronic", "edm"),
    ("house", "edm"),
    ("techno", "edm"),
    ("trance", "edm"),
    ("dance", "dance"),
    ("pop", "pop"),
    ("romantic", "romantic"),
    ("wedding", "wedding"),
    ("retro", "retro"),
]


@dataclass
class Metadata:
    title: str
    artist: str
    year: int | None = None
    language: str = "other"
    moods: list[str] = field(default_factory=lambda: ["party"])
    genre: str | None = None
    source: str = "filename"


def slugify(text: str) -> str:
    """ASCII, lowercase, hyphen separated slug."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def song_id(title: str, artist: str, fallback: str = "") -> str:
    """`title-artist` slug. Falls back to a slug of `fallback` (the file name) when the
    tags are in a script that does not transliterate to ASCII."""
    sid = slugify(f"{title} {artist if artist != UNKNOWN_ARTIST else ''}")
    if not sid:
        sid = slugify(fallback)
    return sid or "song"


def parse_filename(path: Path) -> tuple[str, str | None]:
    """`Artist - Title.ext` -> (title, artist). Without a separator the stem is the title."""
    stem = path.stem.replace("_", " ").strip()
    parts = re.split("\\s+[-\u2013\u2014]\\s+", stem, maxsplit=1)
    if len(parts) == 2 and parts[0].strip() and parts[1].strip():
        return parts[1].strip(), parts[0].strip()
    return stem, None


def _first(tags: object, key: str) -> str | None:
    try:
        val = tags[key]  # type: ignore[index]
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    if isinstance(val, list):
        val = val[0] if val else None
    if val is None:
        return None
    text = str(val).strip()
    return text or None


def read_tags(path: Path) -> dict[str, str]:
    """Easy tags (title, artist, date, genre) via mutagen; empty dict when unavailable."""
    try:
        import mutagen
    except ImportError:
        log.info("mutagen not installed, using file names only")
        return {}
    try:
        f = mutagen.File(str(path), easy=True)
    except Exception as exc:  # noqa: BLE001 (corrupt or unsupported tags are not fatal)
        log.debug("mutagen could not read %s: %s", path.name, exc)
        return {}
    if f is None or f.tags is None:
        return {}
    out: dict[str, str] = {}
    for key in ("title", "artist", "date", "originaldate", "genre"):
        v = _first(f.tags, key)
        if v:
            out[key] = v
    return out


def hints_from_genre(genre: str | None) -> tuple[str, list[str]]:
    if not genre:
        return "other", ["party"]
    g = genre.lower()
    language = next((lang for key, lang in _LANGUAGE_HINTS if key in g), "other")
    moods: list[str] = []
    for key, mood in _MOOD_HINTS:
        # "rap" must be a whole word so that e.g. "trap" still counts but "grape" does not.
        if key == "rap":
            if not re.search(r"\b(rap|trap)\b", g):
                continue
        elif key not in g:
            continue
        if mood not in moods:
            moods.append(mood)
    return language, moods or ["party"]


def read_metadata(path: Path) -> Metadata:
    tags = read_tags(path)
    fn_title, fn_artist = parse_filename(path)
    title = tags.get("title") or fn_title
    artist = tags.get("artist") or fn_artist or UNKNOWN_ARTIST
    year: int | None = None
    m = re.match(r"\s*(\d{4})", tags.get("date") or tags.get("originaldate") or "")
    if m and 1900 <= int(m.group(1)) <= 2100:
        year = int(m.group(1))
    language, moods = hints_from_genre(tags.get("genre"))
    source = "tags" if "title" in tags else "filename"
    return Metadata(title, artist, year, language, moods, tags.get("genre"), source)
