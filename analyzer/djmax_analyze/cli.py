"""Command line entry point.

    python -m djmax_analyze INPUT [INPUT ...] -o library.local.json [--tier core|full]
                            [--no-stems] [--jobs N] [--root DIR]
"""

from __future__ import annotations

import argparse
import importlib.util
import logging
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from .audio import MEDIA_EXTENSIONS
from .schema import load_library, merge_libraries, validate_library, validate_song, write_library

log = logging.getLogger("djmax_analyze")

OPTIONAL_BACKENDS = {
    "allin1": "beats, downbeats and chorus segments",
    "beat_this": "beats and downbeats (used when allin1 is absent)",
    "essentia": "key (EDMA profile)",
    "audio_separator": "vocal stem for vocal regions",
}


def collect_files(inputs: list[Path]) -> list[Path]:
    files: list[Path] = []
    for p in inputs:
        if p.is_dir():
            files.extend(
                f for f in sorted(p.rglob("*"))
                if f.is_file() and f.suffix.lower() in MEDIA_EXTENSIONS and not f.name.startswith(".")
            )
        elif p.is_file():
            files.append(p)
        else:
            log.warning("skipping %s: not found", p)
    # De-duplicate while keeping order.
    seen: set[Path] = set()
    out = []
    for f in files:
        r = f.resolve()
        if r not in seen:
            seen.add(r)
            out.append(f)
    return out


def resolve_root(inputs: list[Path], root: Path | None) -> Path:
    """Folder that media.file paths are relative to: --root, the single input folder,
    or the common parent of the inputs."""
    if root is not None:
        return root.resolve()
    if len(inputs) == 1 and inputs[0].is_dir():
        return inputs[0].resolve()
    parents = [p.resolve() if p.is_dir() else p.resolve().parent for p in inputs]
    return Path(os.path.commonpath([str(p) for p in parents]))


def report_backends(tier: str, stems: bool) -> None:
    log.info("core backends: librosa (beats, key, hook, energy), pyloudnorm (loudness), mutagen (tags)")
    if tier != "full":
        log.info("tier core: optional backends not used, vocals left null")
        return
    for mod, purpose in OPTIONAL_BACKENDS.items():
        if mod == "audio_separator" and not stems:
            log.info("audio-separator: skipped (--no-stems)")
            continue
        found = importlib.util.find_spec(mod) is not None
        log.info("%s: %s (%s)", mod, "available" if found else "not installed, core fallback", purpose)


def _setup_worker_logging(level: int) -> None:
    logging.basicConfig(level=level, format="%(levelname)s %(name)s: %(message)s", force=True)


def _analyse_one(path: str, rel: str, tier: str, stems: bool) -> dict[str, Any]:
    from .pipeline import analyse_file

    return analyse_file(Path(path), rel, tier=tier, stems=stems)


def _unique_ids(songs: list[dict[str, Any]]) -> None:
    """Two different files with the same title and artist get -2, -3 suffixes."""
    counts: dict[str, int] = {}
    for s in songs:
        base = s["id"]
        n = counts.get(base, 0) + 1
        counts[base] = n
        if n > 1:
            s["id"] = f"{base}-{n}"


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="python -m djmax_analyze", description="Analyse local music into a DJmaxing library JSON.")
    ap.add_argument("inputs", nargs="+", type=Path, help="folder(s) or file(s) to analyse")
    ap.add_argument("-o", "--output", type=Path, required=True, help="library JSON to write (merged by id if it exists)")
    ap.add_argument("--tier", choices=("core", "full"), default="core", help="full tries allin1, beat_this, essentia and audio-separator")
    ap.add_argument("--no-stems", action="store_true", help="skip vocal stem separation in the full tier")
    ap.add_argument("--jobs", type=int, default=1, help="parallel worker processes (default 1)")
    ap.add_argument("--root", type=Path, default=None, help="folder that media.file is relative to")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    level = logging.DEBUG if args.verbose else logging.INFO
    _setup_worker_logging(level)
    stems = not args.no_stems

    files = collect_files(args.inputs)
    if not files:
        log.error("no media files found")
        return 1
    root = resolve_root(args.inputs, args.root)
    report_backends(args.tier, stems)
    log.info("analysing %d file(s), paths relative to %s", len(files), root)

    try:
        existing = load_library(args.output)
    except (ValueError, OSError) as exc:
        log.error("cannot read existing output: %s", exc)
        return 1

    jobs_in: list[tuple[str, str]] = []
    for f in files:
        try:
            rel = f.resolve().relative_to(root).as_posix()
        except ValueError:
            rel = f.resolve().as_posix()
            log.warning("%s is outside %s, storing an absolute path", f, root)
        jobs_in.append((str(f), rel))

    results: dict[str, dict[str, Any]] = {}
    failures = 0
    if args.jobs > 1:
        with ProcessPoolExecutor(max_workers=args.jobs, initializer=_setup_worker_logging, initargs=(level,)) as ex:
            futs = {ex.submit(_analyse_one, p, rel, args.tier, stems): rel for p, rel in jobs_in}
            for fut in as_completed(futs):
                rel = futs[fut]
                try:
                    results[rel] = fut.result()
                except Exception as exc:  # noqa: BLE001
                    failures += 1
                    log.error("failed on %s: %s", rel, exc)
    else:
        for p, rel in jobs_in:
            try:
                results[rel] = _analyse_one(p, rel, args.tier, stems)
            except Exception as exc:  # noqa: BLE001
                failures += 1
                log.error("failed on %s: %s", rel, exc)

    songs = [results[rel] for _, rel in jobs_in if rel in results]  # input order
    _unique_ids(songs)
    for s in songs:
        for err in validate_song(s):
            log.warning("validation: %s", err)

    lib = merge_libraries(existing, songs)
    problems = validate_library(lib)
    for err in problems:
        log.warning("library validation: %s", err)
    write_library(args.output, lib)
    log.info("wrote %d song(s) to %s (%d analysed, %d failed)", len(lib["songs"]), args.output, len(songs), failures)
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
