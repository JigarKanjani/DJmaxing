"""Synthetic test songs built with numpy."""

from __future__ import annotations

import numpy as np

SR = 22050


def _midi_hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12)


def _kick(sr: int, amp: float) -> np.ndarray:
    t = np.arange(int(0.25 * sr)) / sr
    freq = 50 + 100 * np.exp(-t * 30)  # pitch sweep 150 -> 50 Hz
    phase = 2 * np.pi * np.cumsum(freq) / sr
    return amp * np.sin(phase) * np.exp(-t * 14)


def _hat(sr: int, amp: float, rng: np.random.Generator) -> np.ndarray:
    n = int(0.05 * sr)
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0.0)  # crude high-pass
    return amp * noise * np.exp(-np.arange(n) / sr * 80)


def _tone(sr: int, midi: float, dur: float, amp: float, harmonics: int = 4) -> np.ndarray:
    t = np.arange(int(dur * sr)) / sr
    f = _midi_hz(midi)
    out = sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, harmonics + 1))
    env = np.minimum(1.0, t / 0.02) * np.minimum(1.0, (dur - t) / 0.05)
    return amp * out * env


def _add(buf: np.ndarray, sig: np.ndarray, start: float, sr: int) -> None:
    i = int(round(start * sr))
    if i >= len(buf):
        return
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n]


# Chords as MIDI notes, all in A (harmonic) minor. The E major chord (G#) separates A minor
# from its relative C major.
AM = [57, 60, 64]
DM = [62, 65, 69]
F = [53, 57, 60]
E = [52, 56, 59]
CHORUS = [AM, F, E, AM]
VERSE = [AM, DM, AM, E]
BASS = {id(AM): 45, id(DM): 50, id(F): 41, id(E): 40}


def make_song(bpm: float = 120.0, t0: float = 0.3, sections: list[tuple[str, int]] | None = None,
              sr: int = SR, seed: int = 0) -> tuple[np.ndarray, dict[str, list[float]]]:
    """Four-on-the-floor song with accented downbeats.

    Beat 1 of each bar has a louder kick and a bass note, other beats a softer kick,
    hats on the off-beats, and a chord pad per bar. Sections are (name, bars) with name
    in intro, verse, chorus, outro. Returns (audio, {section name: [start times]}).
    """
    rng = np.random.default_rng(seed)
    sections = sections or [("intro", 8), ("chorus", 16), ("verse", 16), ("chorus", 16), ("outro", 8)]
    beat = 60.0 / bpm
    bar = 4 * beat
    total_bars = sum(n for _, n in sections)
    buf = np.zeros(int((t0 + total_bars * bar + 2.0) * sr))
    starts: dict[str, list[float]] = {}
    b = 0
    for name, n in sections:
        starts.setdefault(name, []).append(t0 + b * bar)
        loud = name == "chorus"
        prog = CHORUS if name == "chorus" else VERSE
        for k in range(n):
            tb = t0 + (b + k) * bar
            for i in range(4):
                _add(buf, _kick(sr, 1.0 if i == 0 else 0.45), tb + i * beat, sr)
                _add(buf, _hat(sr, 0.12 if loud else 0.06, rng), tb + (i + 0.5) * beat, sr)
            if name in ("intro", "outro"):
                continue
            chord = prog[k % len(prog)]
            pad_amp = 0.10 if loud else 0.05
            for m in chord:
                _add(buf, _tone(sr, m, bar, pad_amp), tb, sr)
                _add(buf, _tone(sr, m + 12, bar, pad_amp * 0.5), tb, sr)
            _add(buf, _tone(sr, BASS[id(chord)], beat * 1.5, 0.35, harmonics=2), tb, sr)
        b += n
    buf /= np.max(np.abs(buf)) * 1.1
    return buf.astype(np.float32), starts


def make_pad(seconds: float = 12.0, sr: int = SR) -> np.ndarray:
    """A minor chord pad only (Am, Dm, E, Am, ...), two seconds per chord."""
    prog = [AM, DM, E, AM]
    buf = np.zeros(int(seconds * sr))
    for k in range(int(seconds // 2)):
        for m in prog[k % 4]:
            _add(buf, _tone(sr, m, 2.0, 0.2), 2.0 * k, sr)
        _add(buf, _tone(sr, BASS[id(prog[k % 4])], 2.0, 0.2), 2.0 * k, sr)
    return (buf / np.max(np.abs(buf)) * 0.8).astype(np.float32)
