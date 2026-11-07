// What every playback engine exposes to the UI.

import type { BuiltSet } from "./types";

export type EngineStatus = "idle" | "loading" | "playing" | "paused" | "finished" | "error";

export interface EngineSnapshot {
  status: EngineStatus;
  /** Index of the song currently live in the set. */
  index: number;
  /** Seconds into the live song's own timeline. */
  position: number;
  /** True while two songs are overlapping or handing over. */
  transitioning: boolean;
  /** Whether the next song is loaded and waiting. */
  nextReady: boolean;
  /** True when the user asked to keep the current song playing. */
  holding: boolean;
  message: string | null;
  /** Songs that could not be played (blocked video, missing file), by set index. */
  skipped: number[];
  log: string[];
}

export interface Engine {
  subscribe(listener: (s: EngineSnapshot) => void): () => void;
  getSnapshot(): EngineSnapshot;
  start(set: BuiltSet, fromIndex?: number): Promise<void>;
  pause(): void;
  resume(): void;
  /** Leave the current song now with a short fade. */
  skip(): void;
  /** Keep the current song playing to its natural end instead of handing over. */
  hold(on: boolean): void;
  setMasterVolume(v: number): void;
  destroy(): void;
}

export function emptySnapshot(): EngineSnapshot {
  return { status: "idle", index: 0, position: 0, transitioning: false, nextReady: false, holding: false, message: null, skipped: [], log: [] };
}

/** Small helper so engines can notify the UI without re-rendering it 25 times a second. */
export class SnapshotEmitter {
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private snapshot: EngineSnapshot = emptySnapshot();
  private lastEmit = 0;

  subscribe(fn: (s: EngineSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  get(): EngineSnapshot {
    return this.snapshot;
  }

  update(patch: Partial<EngineSnapshot>, force = false): void {
    this.snapshot = { ...this.snapshot, ...patch };
    const now = performance.now();
    if (!force && now - this.lastEmit < 150) return;
    this.lastEmit = now;
    for (const fn of this.listeners) fn(this.snapshot);
  }

  log(line: string): void {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const log = [...this.snapshot.log, `${stamp}  ${line}`].slice(-80);
    console.info("[DJmaxing]", line);
    this.update({ log }, true);
  }
}

/** Equal-power curves keep the perceived loudness steady through a crossfade. */
export function fadeGains(kind: "blend" | "fade" | "cut", p: number): { incoming: number; outgoing: number } {
  const x = Math.min(1, Math.max(0, p));
  if (kind === "cut") return { incoming: 1, outgoing: 0 };
  if (kind === "fade") return { incoming: Math.sin((x * Math.PI) / 2), outgoing: Math.cos((x * Math.PI) / 2) };
  // Blend: bring the incoming build up during the first half while the outgoing holds,
  // then let the outgoing go during the second half, the way a DJ rides two faders.
  const incoming = Math.sin((Math.min(1, x * 2) * Math.PI) / 2);
  const outgoing = x < 0.5 ? 1 : Math.cos(((x - 0.5) * 2 * Math.PI) / 2);
  return { incoming, outgoing };
}
