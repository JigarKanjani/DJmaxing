from pathlib import Path

import numpy as np
import soundfile as sf

from djmax_analyze.energy import energy_score
from djmax_analyze.metadata import hints_from_genre, parse_filename, read_metadata, slugify, song_id
from djmax_analyze.vocals import vocal_regions


def test_vocal_regions_hysteresis_and_merge():
    sr = 22050
    rng = np.random.default_rng(1)
    y = rng.standard_normal(sr * 20) * 1e-4  # noise floor
    for a, b in [(2.0, 5.0), (5.8, 8.0), (12.0, 15.0), (17.0, 17.2)]:
        i, j = int(a * sr), int(b * sr)
        y[i:j] += 0.3 * np.sin(2 * np.pi * 220 * np.arange(j - i) / sr)
    regions = vocal_regions(y.astype(np.float32), sr)
    # 2-5 and 5.8-8 merge (gap 0.8 s < 1.5 s); 17.0-17.2 is too short and dropped.
    assert len(regions) == 2
    assert abs(regions[0][0] - 2.0) < 0.1 and abs(regions[0][1] - 8.0) < 0.1
    assert abs(regions[1][0] - 12.0) < 0.1 and abs(regions[1][1] - 15.0) < 0.1


def test_vocal_regions_silence():
    assert vocal_regions(np.zeros(22050 * 3, dtype=np.float32), 22050) == []


def test_energy_score_range_and_order():
    low = energy_score(-35, 0.2, 500, 70)
    high = energy_score(-6, 8, 4000, 130)
    assert low == 1 and high == 10
    mid = energy_score(-14, 3, 2000, 100)
    assert low < mid < high
    assert 1 <= energy_score(-14, 3, 2000, None) <= 10


def test_slug_and_id():
    assert slugify("Kala Chashma") == "kala-chashma"
    assert slugify("Café Déjà Vu!!") == "cafe-deja-vu"
    assert song_id("Kala Chashma", "Badshah") == "kala-chashma-badshah"
    # Non-Latin tags fall back to the file name.
    assert song_id("काला", "बादशाह", fallback="kala chashma") == "kala-chashma"


def test_parse_filename():
    assert parse_filename(Path("Badshah - Kala Chashma.mp3")) == ("Kala Chashma", "Badshah")
    assert parse_filename(Path("just_a_title.wav")) == ("just a title", None)


def test_genre_hints():
    assert hints_from_genre(None) == ("other", ["party"])
    assert hints_from_genre("Bollywood Dance") == ("hindi", ["dance"])
    lang, moods = hints_from_genre("Punjabi Bhangra")
    assert lang == "punjabi" and moods == ["bhangra"]
    assert hints_from_genre("Grape juice")[1] == ["party"]


def test_tags_from_flac(tmp_path):
    from mutagen.flac import FLAC

    p = tmp_path / "whatever.flac"
    sf.write(p, np.zeros(22050, dtype=np.float32), 22050)
    f = FLAC(p)
    f["title"] = "London Thumakda"
    f["artist"] = "Labh Janjua, Sonu Kakkar"
    f["date"] = "2014-02-01"
    f["genre"] = "Bollywood"
    f.save()
    m = read_metadata(p)
    assert (m.title, m.artist, m.year, m.language, m.source) == (
        "London Thumakda", "Labh Janjua, Sonu Kakkar", 2014, "hindi", "tags")
