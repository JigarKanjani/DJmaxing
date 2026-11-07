import numpy as np
import pytest

from djmax_analyze.tempo import fold_tempo, track_beats
from synth import SR, make_song


@pytest.mark.parametrize(
    "raw,expected",
    [(120, 120), (60, 120), (240, 120), (70, 140), (140, 140), (175, 87.5), (190, 95), (45, 90), (100, 100)],
)
def test_fold_tempo(raw, expected):
    assert fold_tempo(raw)[0] == pytest.approx(expected)


def _phase_error(t: float, t0: float, period: float) -> float:
    d = (t - t0) % period
    return min(d, period - d)


@pytest.mark.parametrize("bpm,t0", [(120.0, 0.3), (128.0, 1.05)])
def test_bpm_and_downbeat(bpm, t0):
    y, _ = make_song(bpm=bpm, t0=t0, sections=[("intro", 4), ("verse", 8), ("chorus", 8)])
    res = track_beats(y, SR)
    assert res.bpm is not None and abs(res.bpm - bpm) <= 2.0
    bar = 4 * 60.0 / bpm
    assert res.first_downbeat is not None
    assert _phase_error(res.first_downbeat, t0, bar) < 0.1
    # Every reported downbeat sits on a true bar line.
    errs = [_phase_error(t, t0, bar) for t in res.downbeats if t > t0]
    assert np.median(errs) < 0.1


def test_fit_bar_grid_ignores_flipped_bars():
    from djmax_analyze.tempo import fit_bar_grid

    bar = 2.0
    true = 0.3 + bar * np.arange(60)
    d = true.copy()
    d[:6] += 0.26  # a tracker flipping onto the off-beat in the intro
    d = np.delete(d, [20, 21])  # and missing two bars
    first, fitted_bar = fit_bar_grid(d, bar_guess=2.02)
    assert fitted_bar == pytest.approx(bar, abs=1e-3)
    assert first == pytest.approx(0.3, abs=0.01)
