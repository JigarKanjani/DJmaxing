"""Hook (play window) selection.

Core method: the hook is the most repeated loud section, a good proxy for the chorus or
drop on a dance floor.

1. Bars come from the downbeats. For each bar we average the chroma (harmony) and the
   RMS (loudness) of its frames.
2. Chroma vectors of consecutive bars are stacked (librosa stack_memory, 4 bars) so a
   bar is described by the short progression that ends on it, then a cosine affinity
   recurrence matrix (librosa.segment.recurrence_matrix) links bars that sound alike.
   Links within 4 bars of the diagonal are ignored, so a loop that only repeats inside
   one section scores less than a section that comes back later in the song.
3. Repetition(bar) = row sum of the recurrence matrix, energy(bar) = bar RMS, both
   scaled to 0..1. A window of L bars (16, or 8 for short songs) starting on a 4-bar
   phrase boundary scores mean(repetition) * mean(energy), times a small preference
   for earlier windows so the first chorus wins over an identical later one.
4. entry = downbeat at the best window start; exit = downbeat L bars later, clamped
   to duration - 2 s and snapped back to a downbeat.

With allin1 segments (full tier) the first `chorus` segment start is snapped to the
nearest downbeat and used as entry instead.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .tempo import Segment

log = logging.getLogger(__name__)

HOOK_BARS = 16
SHORT_HOOK_BARS = 8
#: Songs with fewer bars than this get an 8 bar hook.
SHORT_SONG_BARS = 40
END_MARGIN = 2.0
DIAGONAL_EXCLUDE = 4


@dataclass
class Hook:
    entry: float
    exit: float | None
    method: str


def _bar_means(feature: np.ndarray, bar_frames: np.ndarray) -> np.ndarray:
    """Average a (dims, frames) feature over each [bar_frames[i], bar_frames[i+1]) span."""
    out = np.zeros((feature.shape[0], len(bar_frames) - 1))
    for i in range(len(bar_frames) - 1):
        a, b = bar_frames[i], max(bar_frames[i + 1], bar_frames[i] + 1)
        seg = feature[:, a:b]
        if seg.size:
            out[:, i] = seg.mean(axis=1)
    return out


def _exit_for(downbeats: np.ndarray, start_idx: int, bars: int, duration: float) -> float | None:
    """Downbeat `bars` bars after start, clamped to duration - END_MARGIN and snapped to a downbeat."""
    entry = float(downbeats[start_idx])
    limit = duration - END_MARGIN
    target_idx = start_idx + bars
    if target_idx < len(downbeats):
        target = float(downbeats[target_idx])
    else:
        bar_len = float(np.median(np.diff(downbeats))) if len(downbeats) > 1 else 2.0
        target = entry + bars * bar_len
    if target > limit:
        ok = downbeats[(downbeats > entry) & (downbeats <= limit)]
        if ok.size == 0:
            return None
        target = float(ok[-1])
    return target if target > entry else None


def repetition_energy_scores(y: np.ndarray, sr: int, downbeats: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-bar repetition and energy scores, each scaled to 0..1."""
    import librosa

    hop = 512
    frames = librosa.time_to_frames(downbeats, sr=sr, hop_length=hop)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    rms = librosa.feature.rms(y=y, hop_length=hop)
    n = min(chroma.shape[1], rms.shape[1])
    frames = np.clip(frames, 0, n)
    chroma_bars = _bar_means(chroma[:, :n], frames)
    rms_bars = _bar_means(rms[:, :n], frames)[0]
    n_bars = chroma_bars.shape[1]

    stacked = librosa.feature.stack_memory(chroma_bars, n_steps=4, mode="edge")
    rep = np.zeros(n_bars)
    try:
        R = librosa.segment.recurrence_matrix(
            stacked, mode="affinity", metric="cosine", sym=True,
            width=DIAGONAL_EXCLUDE, k=max(2, n_bars // 4),
        )
        rep = np.asarray(R).sum(axis=1)
    except Exception as exc:  # noqa: BLE001 (tiny inputs can fail inside librosa)
        log.debug("recurrence_matrix failed (%s), using plain cosine similarity", exc)
    if not np.any(rep > 0):
        X = stacked / (np.linalg.norm(stacked, axis=0, keepdims=True) + 1e-9)
        S = X.T @ X
        idx = np.arange(n_bars)
        S[np.abs(idx[:, None] - idx[None, :]) < DIAGONAL_EXCLUDE] = 0.0
        rep = np.sort(S, axis=1)[:, -3:].mean(axis=1)
    rep = rep / (rep.max() or 1.0)
    energy = rms_bars / (rms_bars.max() or 1.0)
    return rep, energy


def find_hook_core(y: np.ndarray, sr: int, downbeats: np.ndarray, duration: float) -> Hook | None:
    if downbeats.size < SHORT_HOOK_BARS + 1:
        return None
    rep, energy = repetition_energy_scores(y, sr, downbeats)
    n_bars = rep.size
    bars = HOOK_BARS if n_bars >= SHORT_SONG_BARS else SHORT_HOOK_BARS
    if n_bars < bars:
        bars = SHORT_HOOK_BARS
    starts = [s for s in range(0, n_bars - bars + 1) if s % 4 == 0] or list(range(0, n_bars - bars + 1))
    if not starts:
        return None
    best_s, best_score = starts[0], -1.0
    for s in starts:
        score = rep[s:s + bars].mean() * energy[s:s + bars].mean()
        score *= 1.0 - 0.15 * s / n_bars  # mild preference for the first occurrence
        if score > best_score:
            best_s, best_score = s, score
    entry = float(downbeats[best_s])
    if entry > duration - END_MARGIN:
        return None
    return Hook(entry, _exit_for(downbeats, best_s, bars, duration), f"repetition x energy, {bars} bars")


def find_hook_from_segments(segments: list[Segment], downbeats: np.ndarray, duration: float) -> Hook | None:
    chorus = next((s for s in segments if s.label.lower() == "chorus"), None)
    if chorus is None or downbeats.size == 0:
        return None
    idx = int(np.argmin(np.abs(downbeats - chorus.start)))
    remaining = downbeats.size - idx
    bars = HOOK_BARS if remaining > HOOK_BARS else SHORT_HOOK_BARS
    return Hook(float(downbeats[idx]), _exit_for(downbeats, idx, bars, duration), "allin1 first chorus")


def find_hook(y: np.ndarray, sr: int, downbeats: np.ndarray, duration: float,
              segments: list[Segment] | None = None) -> Hook | None:
    if segments:
        hook = find_hook_from_segments(segments, downbeats, duration)
        if hook is not None:
            return hook
        log.info("no chorus segment from allin1, using repetition x energy hook")
    return find_hook_core(y, sr, downbeats, duration)
