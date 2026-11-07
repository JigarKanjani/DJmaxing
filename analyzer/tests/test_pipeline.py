"""End to end: synthesise a song, run the CLI, check the library file."""

import json
import math

import pytest
import soundfile as sf

from djmax_analyze.cli import main
from djmax_analyze.schema import validate_library
from synth import SR, make_song

BPM, T0 = 120.0, 0.3


@pytest.fixture(scope="module")
def analysed(tmp_path_factory):
    root = tmp_path_factory.mktemp("music")
    (root / "sub").mkdir()
    y, starts = make_song(bpm=BPM, t0=T0)
    sf.write(root / "sub" / "Test Artist - Synth Song.wav", y, SR)
    out = root / "library.local.json"
    assert main([str(root), "-o", str(out)]) == 0
    lib = json.loads(out.read_text())
    return root, out, lib, starts


def test_library_validates(analysed):
    _, _, lib, _ = analysed
    assert validate_library(lib) == []
    assert lib["version"] == 1 and len(lib["songs"]) == 1


def test_fields(analysed):
    _, _, lib, _ = analysed
    s = lib["songs"][0]
    assert s["id"] == "synth-song-test-artist"
    assert (s["title"], s["artist"]) == ("Synth Song", "Test Artist")
    assert s["media"] == {"youtube": [], "file": "sub/Test Artist - Synth Song.wav", "spotifyUri": None}
    assert s["analysis"]["source"] == "analyzer" and s["analysis"]["verified"] is False
    assert s["language"] == "other" and s["moods"] == ["party"] and s["fame"] == 2
    assert s["vocals"] is None
    assert abs(s["bpm"] - BPM) <= 2
    assert s["camelot"] == "8A"
    assert isinstance(s["loudnessLufs"], float) and math.isfinite(s["loudnessLufs"])
    assert 1 <= s["energy"] <= 10 and isinstance(s["energy"], int)
    assert s["durationSec"] == pytest.approx(130.3, abs=0.1)


def test_downbeat_phase(analysed):
    _, _, lib, _ = analysed
    grid = lib["songs"][0]["beatGrid"]
    bar = 4 * 60.0 / BPM
    d = (grid["firstDownbeat"] - T0) % bar
    assert min(d, bar - d) < 0.1
    assert grid["beatsPerBar"] == 4


def test_hook_is_a_chorus(analysed):
    _, _, lib, starts = analysed
    hook = lib["songs"][0]["hook"]
    assert any(abs(hook["entry"] - c) < 0.1 for c in starts["chorus"]), (hook, starts)
    assert hook["exit"] == pytest.approx(hook["entry"] + 16 * 4 * 60.0 / BPM, abs=0.1)


def test_rerun_merges_and_keeps_verified(analysed):
    root, out, lib, _ = analysed
    lib["songs"][0]["energy"] = 3
    lib["songs"][0]["fame"] = 3
    lib["songs"][0]["moods"] = ["bhangra", "wedding"]
    lib["songs"][0]["hook"] = {"entry": 40.0, "exit": 72.0}
    lib["songs"][0]["media"]["youtube"] = ["dQw4w9WgXcQ"]
    lib["songs"][0]["analysis"]["verified"] = True
    other = dict(lib["songs"][0], id="someone-else", media={"youtube": [], "file": None, "spotifyUri": None})
    lib["songs"].insert(0, other)
    out.write_text(json.dumps(lib))

    assert main([str(root), "-o", str(out)]) == 0
    new = json.loads(out.read_text())
    assert validate_library(new) == []
    assert [s["id"] for s in new["songs"]] == ["someone-else", "synth-song-test-artist"]
    s = new["songs"][1]
    assert (s["energy"], s["fame"], s["moods"]) == (3, 3, ["bhangra", "wedding"])
    assert s["hook"] == {"entry": 40.0, "exit": 72.0}
    assert s["media"]["youtube"] == ["dQw4w9WgXcQ"]
    assert s["analysis"]["verified"] is True
