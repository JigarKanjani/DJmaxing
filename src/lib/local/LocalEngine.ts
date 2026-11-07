// Mixes the user's own audio or video files with the Web Audio API.
//
// Because the browser owns the audio here, transitions are scheduled sample-accurately on the
// AudioContext clock: the incoming song is time-stretched to the outgoing tempo, started so its
// hook lands exactly on the outgoing phrase end, and the bass is swapped halfway through the blend.

import { fadeGains, SnapshotEmitter, type Engine, type EngineSnapshot } from "../engine";
import type { BuiltSet, Song, TransitionPlan } from "../types";
import { createVoice, type Voice } from "./voice";

type DeckId = "A" | "B";
type DeckStatus = "empty" | "loading" | "ready" | "scheduled" | "live";

interface LocalDeck {
  id: DeckId;
  host: HTMLElement;
  status: DeckStatus;
  entry: number | null;
  voice: Voice | null;
  trim: GainNode;
  bass: BiquadFilterNode;
  fader: GainNode;
  video: HTMLVideoElement | null;
  objectUrl: string | null;
  from: number;
  duration: number;
}

export const TARGET_LUFS = -14;
const LOOKAHEAD_S = 4;
const BASS_CUT_DB = -26;

export interface LocalEngineOptions {
  hostA: HTMLElement;
  hostB: HTMLElement;
  /** Files the user picked, keyed by their relative path inside the chosen folder. */
  files: Map<string, File>;
  onLiveDeck?: (deck: DeckId) => void;
}

/** Finds the picked file for a song: exact relative path, then path without the top folder, then file name. */
export function resolveFile(files: Map<string, File>, path: string | null): File | null {
  if (!path) return null;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
  const want = norm(path);
  const byNorm = new Map<string, File>();
  for (const [k, f] of files) byNorm.set(norm(k), f);
  if (byNorm.has(want)) return byNorm.get(want) ?? null;
  for (const [k, f] of byNorm) if (k.endsWith("/" + want) || k.split("/").slice(1).join("/") === want) return f;
  const name = want.split("/").pop();
  for (const [k, f] of byNorm) if (k.split("/").pop() === name) return f;
  return null;
}

export function loudnessTrim(song: Song): number {
  if (typeof song.loudnessLufs !== "number" || !Number.isFinite(song.loudnessLufs)) return 1;
  return Math.min(2, Math.max(0.25, 10 ** ((TARGET_LUFS - song.loudnessLufs) / 20)));
}

export class LocalEngine implements Engine {
  private emitter = new SnapshotEmitter();
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private decks: Record<DeckId, LocalDeck> | null = null;
  private set: BuiltSet | null = null;
  private live: DeckId | null = null;
  private tick: number | null = null;
  private raf: number | null = null;
  private completeTimer: number | null = null;
  private holding = false;
  private ending = false;
  private transitioning = false;
  private masterLevel = 1;
  private skipRequested = false;

  constructor(private opts: LocalEngineOptions) {}

  subscribe(fn: (s: EngineSnapshot) => void) {
    return this.emitter.subscribe(fn);
  }
  getSnapshot() {
    return this.emitter.get();
  }

  /** The mixed output, for visualisers. Null until the set starts. */
  get output(): AnalyserNode | null {
    return this.analyser;
  }
  get audioContext(): AudioContext | null {
    return this.ctx;
  }
  /** True when the live song has its own video. */
  liveHasVideo(): boolean {
    const d = this.live && this.decks ? this.decks[this.live] : null;
    return !!d?.video;
  }

  private setupGraph(): void {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: "playback" });
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    // A fast, hard limiter: stops two overlapping songs from clipping.
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.analyser = ctx.createAnalyser();
    this.masterGain.connect(this.limiter).connect(this.analyser).connect(ctx.destination);
    const deck = (id: DeckId, host: HTMLElement): LocalDeck => {
      const trim = ctx.createGain();
      const bass = ctx.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 180;
      bass.gain.value = 0;
      const fader = ctx.createGain();
      fader.gain.value = 0;
      trim.connect(bass).connect(fader).connect(this.masterGain!);
      return { id, host, status: "empty", entry: null, voice: null, trim, bass, fader, video: null, objectUrl: null, from: 0, duration: 0 };
    };
    this.decks = { A: deck("A", this.opts.hostA), B: deck("B", this.opts.hostB) };
  }

  async start(set: BuiltSet, fromIndex = 0): Promise<void> {
    this.setupGraph();
    const ctx = this.ctx!;
    await ctx.resume();
    this.stopAll();
    this.set = set;
    this.emitter.update({ status: "loading", index: fromIndex, skipped: [], message: null, holding: false }, true);
    const a = this.decks!.A;
    let index = fromIndex;
    while (index < set.entries.length && !(await this.load(a, index, set.entries[index]?.start ?? 0))) index++;
    if (index >= set.entries.length || !a.voice) {
      this.finish("None of the songs in this set could be loaded from the folder you picked.");
      return;
    }
    const when = ctx.currentTime + 0.15;
    a.voice.start(when, a.from, 1);
    a.fader.gain.setValueAtTime(1, when);
    a.status = "live";
    this.live = "A";
    this.opts.onLiveDeck?.("A");
    this.emitter.update({ status: "playing", index }, true);
    this.emitter.log(`Live: ${this.title(index)}${a.voice.keyLock ? "" : " (key lock unavailable, tempo changes shift pitch)"}`);
    void this.preloadNext();
    this.tick = window.setInterval(() => this.onTick(), 50);
    this.raf = requestAnimationFrame(this.syncVideo);
  }

  pause(): void {
    void this.ctx?.suspend();
    for (const d of Object.values(this.decks ?? {})) d.video?.pause();
    this.emitter.update({ status: "paused" }, true);
  }

  resume(): void {
    void this.ctx?.resume();
    this.emitter.update({ status: "playing" }, true);
  }

  skip(): void {
    if (this.transitioning) return;
    this.skipRequested = true;
    this.emitter.log("Skip: handing over at the next possible moment.");
  }

  hold(on: boolean): void {
    this.holding = on;
    this.emitter.update({ holding: on }, true);
    this.emitter.log(on ? "Holding this song to its end." : "Back to the planned mix.");
  }

  setMasterVolume(v: number): void {
    this.masterLevel = Math.min(1, Math.max(0, v));
    if (this.masterGain && this.ctx) this.masterGain.gain.setTargetAtTime(this.masterLevel, this.ctx.currentTime, 0.05);
  }

  destroy(): void {
    this.stopAll();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    void this.ctx?.close();
    this.ctx = null;
  }

  // ---------------------------------------------------------------------------

  private stopAll() {
    if (this.tick !== null) window.clearInterval(this.tick);
    if (this.completeTimer !== null) window.clearTimeout(this.completeTimer);
    this.tick = null;
    this.completeTimer = null;
    for (const d of Object.values(this.decks ?? {})) this.unload(d);
    this.live = null;
    this.transitioning = false;
    this.ending = false;
    this.holding = false;
    this.skipRequested = false;
  }

  private unload(d: LocalDeck) {
    const now = this.ctx?.currentTime ?? 0;
    d.voice?.stop(now);
    d.voice?.dispose();
    d.voice = null;
    d.fader.gain.cancelScheduledValues(now);
    d.fader.gain.setValueAtTime(0, now);
    d.bass.gain.cancelScheduledValues(now);
    d.bass.gain.setValueAtTime(0, now);
    if (d.video) {
      d.video.pause();
      d.video.remove();
    }
    if (d.objectUrl) URL.revokeObjectURL(d.objectUrl);
    d.video = null;
    d.objectUrl = null;
    d.status = "empty";
    d.entry = null;
  }

  private title(index: number | null): string {
    const s = index !== null ? this.set?.entries[index]?.song : undefined;
    return s ? `"${s.title}" by ${s.artist}` : "(nothing)";
  }

  /** Decodes a song into a deck. Returns false if the file is missing or cannot be decoded. */
  private async load(d: LocalDeck, index: number, from: number): Promise<boolean> {
    const entry = this.set?.entries[index];
    const ctx = this.ctx;
    if (!entry || !ctx) return false;
    this.unload(d);
    d.status = "loading";
    d.entry = index;
    const file = resolveFile(this.opts.files, entry.song.media.file);
    if (!file) {
      this.emitter.log(`Skipping ${this.title(index)}: file "${entry.song.media.file}" is not in the picked folder.`);
      this.markSkipped(index);
      d.status = "empty";
      return false;
    }
    try {
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const voice = await createVoice(ctx, buffer);
      if (d.entry !== index) {
        voice.dispose();
        return false; // A newer load replaced this one.
      }
      voice.output.connect(d.trim);
      d.trim.gain.value = loudnessTrim(entry.song);
      d.voice = voice;
      d.from = Math.max(0, from);
      d.duration = buffer.duration;
      if (file.type.startsWith("video/")) {
        d.objectUrl = URL.createObjectURL(file);
        const v = document.createElement("video");
        v.src = d.objectUrl;
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.currentTime = d.from;
        d.host.replaceChildren(v);
        d.video = v;
      } else {
        d.host.replaceChildren();
      }
      d.status = "ready";
      return true;
    } catch (e) {
      this.emitter.log(`Skipping ${this.title(index)}: the browser could not decode it (${(e as Error).message}).`);
      this.markSkipped(index);
      d.status = "empty";
      return false;
    }
  }

  private markSkipped(index: number) {
    this.emitter.update({ skipped: [...this.emitter.get().skipped, index] }, true);
  }

  private async preloadNext(): Promise<void> {
    if (!this.live || !this.decks || !this.set) return;
    const live = this.decks[this.live];
    const other = this.decks[this.live === "A" ? "B" : "A"];
    if (live.entry === null) return;
    let index = live.entry + 1;
    while (index < this.set.entries.length) {
      const planned = index === live.entry + 1;
      const plan = this.set.entries[live.entry]?.transition;
      const from = planned && plan ? plan.inFrom : (this.set.entries[index]?.start ?? 0);
      if (await this.load(other, index, from)) {
        this.emitter.update({ nextReady: true }, true);
        this.emitter.log(`Deck ${other.id} ready: ${this.title(index)}`);
        return;
      }
      index++;
    }
    this.emitter.update({ nextReady: false }, true);
  }

  private onTick() {
    const ctx = this.ctx;
    if (!ctx || !this.decks || !this.set || !this.live || ctx.state !== "running") return;
    const live = this.decks[this.live];
    if (!live.voice || live.entry === null) return;
    const now = ctx.currentTime;
    const pos = live.voice.positionAt(now);
    this.emitter.update({ position: pos, index: live.entry, transitioning: this.transitioning });
    if (this.transitioning || this.ending) return;

    const next = this.decks[this.live === "A" ? "B" : "A"];
    const entry = this.set.entries[live.entry];
    if (!entry) return;
    const naturalEnd = live.duration - 0.05;

    if (this.skipRequested && next.status === "ready") {
      this.skipRequested = false;
      const plan: TransitionPlan = { kind: "fade", outAt: pos + 2.5, inFrom: next.from, inAlign: next.from + 2.5, overlap: 2.5, rate: 1, why: "Skipped" };
      this.schedule(live, next, plan, now + 0.1);
      return;
    }
    if (next.status !== "ready") {
      if (next.status === "empty" && pos >= (this.holding ? naturalEnd - 4 : entry.end)) this.endSet(live);
      return;
    }
    const planned = next.entry === live.entry + 1;
    let plan: TransitionPlan | null = entry.transition;
    if (this.holding || !plan) {
      // Play to the natural end, then cut.
      if (pos < naturalEnd - LOOKAHEAD_S) return;
      plan = { kind: "fade", outAt: naturalEnd, inFrom: next.from, inAlign: next.from + 2, overlap: 2, rate: 1, why: "Song ended" };
    } else if (!planned) {
      plan = { ...plan, kind: "fade", overlap: 3, rate: 1, inFrom: next.from, inAlign: next.from + 3 };
    }
    const startPos = plan.kind === "cut" ? plan.outAt : plan.outAt - plan.overlap;
    const at = live.voice.timeAtPosition(startPos);
    if (at - now > LOOKAHEAD_S) return;
    this.schedule(live, next, plan, Math.max(now + 0.05, at));
  }

  private schedule(from: LocalDeck, to: LocalDeck, plan: TransitionPlan, at: number) {
    const ctx = this.ctx;
    if (!ctx || !to.voice || !from.voice) return;
    this.transitioning = true;
    to.status = "scheduled";
    const overlap = plan.kind === "cut" ? 0 : plan.overlap;
    to.voice.start(at, plan.inFrom, plan.rate);
    if (plan.kind === "cut") {
      to.fader.gain.setValueAtTime(1, at);
      from.fader.gain.setValueAtTime(1, at - 0.01);
      from.fader.gain.linearRampToValueAtTime(0, at + 0.01);
    } else {
      const steps = 128;
      const inCurve = new Float32Array(steps);
      const outCurve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) {
        const g = fadeGains(plan.kind, i / (steps - 1));
        inCurve[i] = g.incoming;
        outCurve[i] = g.outgoing;
      }
      to.fader.gain.cancelScheduledValues(at);
      from.fader.gain.cancelScheduledValues(at);
      to.fader.gain.setValueCurveAtTime(inCurve, at, overlap);
      from.fader.gain.setValueCurveAtTime(outCurve, at, overlap);
      if (plan.kind === "blend") {
        // Bass swap: only one kick drum and bassline at a time, switched on a beat halfway through.
        const mid = at + overlap / 2;
        const beat = Math.min(0.5, overlap / 16);
        to.bass.gain.setValueAtTime(BASS_CUT_DB, at);
        to.bass.gain.setValueAtTime(BASS_CUT_DB, mid);
        to.bass.gain.linearRampToValueAtTime(0, mid + beat);
        from.bass.gain.setValueAtTime(0, mid);
        from.bass.gain.linearRampToValueAtTime(BASS_CUT_DB, mid + beat);
      }
    }
    const end = at + overlap;
    from.voice.stop(end + 0.05);
    // Ease the incoming song back to its own tempo over 16 seconds, so the next match starts clean.
    if (Math.abs(plan.rate - 1) > 0.001) {
      for (let k = 1; k <= 8; k++) to.voice.setRate(end + 2 * k, plan.rate + ((1 - plan.rate) * k) / 8);
    }
    const kindText = plan.kind === "blend" ? "Blending" : plan.kind === "cut" ? "Cutting" : "Fading";
    this.emitter.log(`${kindText} into ${this.title(to.entry)} in ${(at - ctx.currentTime).toFixed(1)}s. ${plan.why}`);
    this.completeTimer = window.setTimeout(() => this.complete(from, to), Math.max(0, (end - ctx.currentTime) * 1000 + 120));
  }

  private complete(from: LocalDeck, to: LocalDeck) {
    this.completeTimer = null;
    this.unload(from);
    to.status = "live";
    this.live = to.id;
    this.transitioning = false;
    this.holding = false;
    this.opts.onLiveDeck?.(to.id);
    this.emitter.update({ index: to.entry ?? 0, transitioning: false, holding: false, nextReady: false }, true);
    this.emitter.log(`Live: ${this.title(to.entry)}`);
    void this.preloadNext();
  }

  private endSet(d: LocalDeck) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ending = true;
    const now = ctx.currentTime;
    d.fader.gain.cancelScheduledValues(now);
    d.fader.gain.setValueAtTime(d.fader.gain.value, now);
    d.fader.gain.linearRampToValueAtTime(0, now + 4);
    d.voice?.stop(now + 4.1);
    window.setTimeout(() => this.finish("End of the set."), 4200);
  }

  private finish(message: string) {
    if (this.tick !== null) window.clearInterval(this.tick);
    this.tick = null;
    this.emitter.update({ status: "finished", message, transitioning: false }, true);
    this.emitter.log(message);
  }

  /** Keeps muted video elements in step with the audio clock. */
  private syncVideo = () => {
    this.raf = requestAnimationFrame(this.syncVideo);
    const ctx = this.ctx;
    if (!ctx || !this.decks) return;
    const now = ctx.currentTime;
    for (const d of Object.values(this.decks)) {
      const v = d.video;
      if (!v || !d.voice) continue;
      const pos = d.voice.positionAt(now);
      // Before its scheduled start, a voice reports its start position; after, it moves forward.
      const started = d.status === "live" || (d.status === "scheduled" && pos > d.from + 0.005);
      if (!started || ctx.state !== "running") {
        if (!v.paused) v.pause();
        continue;
      }
      v.playbackRate = d.voice.rateAt(now);
      if (v.paused) void v.play().catch(() => undefined);
      if (Math.abs(v.currentTime - pos) > 0.12) v.currentTime = pos;
    }
  };
}
