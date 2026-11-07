import numpy as np
import pytest

from djmax_analyze.key import KK_MAJOR, KK_MINOR, estimate_key, key_from_chroma, pitch_class, to_camelot
from synth import SR, make_pad

# The standard Camelot wheel, written out by hand (not derived from the formula).
CAMELOT_TABLE = {
    ("C", "major"): "8B", ("G", "major"): "9B", ("D", "major"): "10B", ("A", "major"): "11B",
    ("E", "major"): "12B", ("B", "major"): "1B", ("F#", "major"): "2B", ("Db", "major"): "3B",
    ("Ab", "major"): "4B", ("Eb", "major"): "5B", ("Bb", "major"): "6B", ("F", "major"): "7B",
    ("A", "minor"): "8A", ("E", "minor"): "9A", ("B", "minor"): "10A", ("F#", "minor"): "11A",
    ("C#", "minor"): "12A", ("G#", "minor"): "1A", ("D#", "minor"): "2A", ("Bb", "minor"): "3A",
    ("F", "minor"): "4A", ("C", "minor"): "5A", ("G", "minor"): "6A", ("D", "minor"): "7A",
}


def test_camelot_table_all_24_keys():
    assert len(CAMELOT_TABLE) == 24
    for (note, mode), expected in CAMELOT_TABLE.items():
        assert to_camelot(pitch_class(note), mode) == expected, (note, mode)
    # Every Camelot code is hit exactly once.
    assert len(set(CAMELOT_TABLE.values())) == 24


def test_pitch_class_enharmonics():
    assert pitch_class("Bb") == pitch_class("A#") == 10
    assert pitch_class("eb") == 3
    assert pitch_class("C") == 0


def test_bad_mode():
    with pytest.raises(ValueError):
        to_camelot(0, "dorian")


@pytest.mark.parametrize("tonic", range(12))
def test_key_from_profile_vectors(tonic):
    assert key_from_chroma(np.roll(KK_MAJOR, tonic))[:2] == (tonic, "major")
    assert key_from_chroma(np.roll(KK_MINOR, tonic))[:2] == (tonic, "minor")


def test_key_on_a_minor_pad():
    res = estimate_key(make_pad(), SR)
    assert res is not None
    assert res.name == "A minor"
    assert res.camelot == "8A"
