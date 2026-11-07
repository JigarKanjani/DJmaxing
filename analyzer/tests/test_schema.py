import copy

from djmax_analyze.schema import merge_libraries, validate_library, validate_song

GOOD = {
    "id": "kala-chashma-badshah",
    "title": "Kala Chashma",
    "artist": "Badshah, Neha Kakkar",
    "language": "hindi",
    "moods": ["party", "dance"],
    "year": 2016,
    "energy": 9,
    "fame": 3,
    "bpm": 104.0,
    "camelot": "8A",
    "beatGrid": {"firstDownbeat": 0.42, "beatsPerBar": 4},
    "hook": {"entry": 31.2, "exit": None},
    "vocals": [[10.0, 20.5]],
    "loudnessLufs": -8.1,
    "durationSec": 187.3,
    "media": {"youtube": ["k4yXQkG2s1E"], "file": None, "spotifyUri": None},
    "analysis": {"source": "manual", "verified": True, "notes": "checked"},
}


def bad(**changes):
    s = copy.deepcopy(GOOD)
    for k, v in changes.items():
        s[k] = v
    return s


def test_good_song_validates():
    assert validate_song(GOOD) == []
    nulls = bad(year=None, bpm=None, camelot=None, beatGrid=None, hook=None, vocals=None,
                loudnessLufs=None, durationSec=None)
    assert validate_song(nulls) == []


def test_bad_songs():
    cases = [
        bad(id="Kala Chashma"), bad(title=""), bad(language="french"), bad(moods=[]),
        bad(moods=["chill"]), bad(energy=11), bad(energy=None), bad(fame=4), bad(bpm=-1),
        bad(camelot="13A"), bad(camelot="8C"), bad(beatGrid={"beatsPerBar": 4}),
        bad(hook={"entry": 30.0, "exit": 10.0}), bad(hook={"entry": 30.0}), bad(vocals=[[3, 1]]),
        bad(loudnessLufs=float("nan")), bad(media={"youtube": ["short"], "file": None, "spotifyUri": None}),
        bad(media={"youtube": [], "file": None, "spotifyUri": "track:1"}),
        bad(analysis={"source": "robot", "verified": False}), bad(analysis={"source": "tap", "verified": "no"}),
    ]
    for c in cases:
        assert validate_song(c), c


def test_library_level():
    assert validate_library({"version": 1, "songs": [GOOD]}) == []
    assert validate_library({"version": 2, "songs": []})
    assert any("duplicate" in e for e in validate_library({"version": 1, "songs": [GOOD, GOOD]}))


def _new(**changes):
    s = bad(**changes)
    s["media"] = {"youtube": [], "file": "a/b.mp3", "spotifyUri": None}
    s["analysis"] = {"source": "analyzer", "verified": False, "notes": "beats: librosa"}
    return s


def test_merge_unverified_is_replaced_but_keeps_links():
    old = bad(energy=4, fame=1, analysis={"source": "analyzer", "verified": False, "notes": "old run"},
              media={"youtube": ["k4yXQkG2s1E"], "file": None, "spotifyUri": "spotify:track:abc"})
    lib = merge_libraries({"version": 1, "songs": [old]}, [_new(energy=8, bpm=110.0)])
    s = lib["songs"][0]
    assert (s["energy"], s["fame"], s["bpm"]) == (8, 3, 110.0)
    assert s["media"] == {"youtube": ["k4yXQkG2s1E"], "file": "a/b.mp3", "spotifyUri": "spotify:track:abc"}
    assert s["analysis"] == {"source": "analyzer", "verified": False, "notes": "beats: librosa"}


def test_merge_verified_keeps_manual_and_timing_fills_nulls():
    old = bad(energy=4, fame=1, moods=["sad"], camelot=None, loudnessLufs=None)
    lib = merge_libraries({"version": 1, "songs": [old]},
                          [_new(energy=8, fame=2, moods=["party"], bpm=150.0, camelot="9A", loudnessLufs=-9.0)])
    s = lib["songs"][0]
    assert (s["energy"], s["fame"], s["moods"]) == (4, 1, ["sad"])
    assert s["bpm"] == 104.0 and s["hook"] == GOOD["hook"] and s["beatGrid"] == GOOD["beatGrid"]
    assert s["camelot"] == "9A" and s["loudnessLufs"] == -9.0
    assert s["media"]["file"] == "a/b.mp3"
    assert s["analysis"] == GOOD["analysis"]


def test_merge_appends_new_and_keeps_others():
    lib = merge_libraries({"version": 1, "songs": [GOOD]}, [_new(id="new-song")])
    assert [s["id"] for s in lib["songs"]] == ["kala-chashma-badshah", "new-song"]
    assert lib["songs"][0] == GOOD
    assert merge_libraries(None, [_new()])["songs"][0]["id"] == GOOD["id"]
