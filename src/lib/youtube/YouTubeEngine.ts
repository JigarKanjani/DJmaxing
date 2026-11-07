// Two visible YouTube players used as decks A and B.
//
// YouTube gives us play, pause, seek and volume, but no access to the audio itself, so this
// engine works by timing: the next video is loaded and parked at its start point, then started
// slightly early (by the measured start-up delay) so its hook lands on the outgoing phrase end.

import type { BuiltSet, TransitionPlan } from "../types";
import { fadeGains, SnapshotEmitter, type Engine, type EngineSnapshot } from "../engine";
import { loadYouTubeApi } from "./loadApi";

type DeckId = "A" | "B";
type DeckStatus = "empty" | "loading" | "ready" | "starting" | "live";

interface Deck {
  id: DeckId;
  host: HTMLElement;
  player: YT.Player | null;
  status: DeckStatus;
  entry: number | null;
  videoIdx: number;
  from: number;
  loadTimer: number | null;
  triggeredAt: number;
}

interface ActiveTransition {
  plan: TransitionPlan;
  from: Deck;
  to: Deck;
  /** Outgoing song position where the incoming song starts. */
  startPos: number;
  incomingPlaying: boolean;
  corrected: boolean;
}

const PLAYER_VARS: YT.PlayerVars = {
  autoplay: 0,
  controls: 0,
  disablekb: 1,
  fs: 0,
  iv_load_policy: 3,
  playsinline: 1,
  rel: 0,
};

const LOAD_TIMEOUT_MS = 12000;
const START_TIMEOUT_MS = 5000;
const TICK_MS = 30;

export interface YouTubeEngineOptions {
  hostA: HTMLElement;
  hostB: HTMLElement;
  /** Called whenever which deck is live changes, so the UI can resize them. */
  onLiveDeck?: (deck: DeckId) => void;
}

export class YouTubeEngine implements Engine {
  private emitter = new SnapshotEmitter();
  private decks: Record<DeckId, Deck>;
  private set: BuiltSet | null = null;
  private live: DeckId | null = null;
  private trans: ActiveTransition | null = null;
  private tick: number | null = null;
  private master = 1;
  private paused = false;
  private holding = false;
  private ending = false;
  /** Seconds between playVideo() and audible playback, learned as the set plays. */
  private latency = 0.3;
  private destroyed = false;
  private waitingSince = 0;

  constructor(private opts: YouTubeEngineOptions) {
    const deck = (id: DeckId, host: HTMLElement): Deck => ({ id, host, player: null, status: "empty", entry: null, videoIdx: 0, from: 0, loadTimer: null, triggeredAt: 0 });
    this.decks = { A: deck("A", opts.hostA), B: deck("B", opts.hostB) };
  }

  subscribe(fn: (s: EngineSnapshot) => void) {
    return this.emitter.subscribe(fn);
  }
  getSnapshot() {
    return this.emitter.get();
  }

  async init(): Promise<void> {
    const YTApi = await loadYouTubeApi();
    if (this.destroyed) return;
    await Promise.all(
      (["A", "B"] as DeckId[]).map(
        (id) =>
          new Promise<void>((resolve) => {
            const d = this.decks[id];
            const mount = document.createElement("div");
            d.host.replaceChildren(mount);
            d.player = new YTApi.Player(mount, {
              width: "100%",
              height: "100%",
              playerVars: { ...PLAYER_VARS, origin: window.location.origin },
              events: {
                onReady: () => resolve(),
                onStateChange: (e) => this.onState(d, e.data),
                onError: (e) => this.onError(d, e.data),
              },
            });
          }),
      ),
    );
    this.emitter.log("Both decks ready.");
  }

  async start(set: BuiltSet, fromIndex = 0): Promise<void> {
    if (!this.decks.A.player) await this.init();
    this.reset();
    this.set = set;
    this.emitter.update({ status: "loading", index: fromIndex, skipped: [], message: null }, true);
    const a = this.decks.A;
    this.live = "A";
    this.opts.onLiveDeck?.("A");
    this.prepare(a, fromIndex, set.entries[fromIndex]?.start ?? 0);
    // The first song starts as soon as it is buffered, at full volume.
    a.status = "loading";
    this.tick = window.setInterval(() => this.onTick(), TICK_MS);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const d of Object.values(this.decks)) if (d.status === "live" || d.status === "starting") d.player?.pauseVideo();
    this.emitter.update({ status: "paused" }, true);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const live = this.liveDeck();
    live?.player?.playVideo();
    if (this.trans?.incomingPlaying) this.trans.to.player?.playVideo();
    this.emitter.update({ status: "playing" }, true);
  }

  skip(): void {
    const live = this.liveDeck();
    if (!live || !live.player || this.trans || this.ending) return;
    const next = this.otherDeck(live.id);
    const t = live.player.getCurrentTime();
    if (next.status !== "ready") {
      this.emitter.log("Skip pressed but the next song is still loading. It will play as soon as it is ready.");
      this.holding = false;
      this.forceHandoffWhenReady = true;
      return;
    }
    const plan: TransitionPlan = { kind: "fade", outAt: t + 1.5, inFrom: next.from, inAlign: next.from + 1.5, overlap: 1.5, rate: 1, why: "Skipped" };
    this.emitter.log(`Skip: fading out at ${t.toFixed(1)}s.`);
    this.begin(live, next, plan, t);
  }

  hold(on: boolean): void {
    this.holding = on;
    this.emitter.update({ holding: on }, true);
    this.emitter.log(on ? "Holding this song to its end." : "Back to the planned mix.");
  }

  setMasterVolume(v: number): void {
    this.master = Math.min(1, Math.max(0, v));
    if (!this.trans) this.liveDeck()?.player?.setVolume(Math.round(100 * this.master));
  }

  destroy(): void {
    this.destroyed = true;
    this.reset();
    for (const d of Object.values(this.decks)) {
      try {
        d.player?.destroy();
      } catch {
        // The iframe may already be gone.
      }
      d.player = null;
    }
  }

  // ---------------------------------------------------------------------------

  private forceHandoffWhenReady = false;

  private reset() {
    if (this.tick !== null) window.clearInterval(this.tick);
    this.tick = null;
    for (const d of Object.values(this.decks)) {
      this.clearTimer(d);
      d.status = "empty";
      d.entry = null;
      try {
        d.player?.stopVideo();
      } catch {
        // Player not ready yet.
      }
    }
    this.trans = null;
    this.paused = false;
    this.holding = false;
    this.ending = false;
    this.forceHandoffWhenReady = false;
    this.live = null;
  }

  private liveDeck(): Deck | null {
    return this.live ? this.decks[this.live] : null;
  }
  private otherDeck(id: DeckId): Deck {
    return this.decks[id === "A" ? "B" : "A"];
  }
  private clearTimer(d: Deck) {
    if (d.loadTimer !== null) window.clearTimeout(d.loadTimer);
    d.loadTimer = null;
  }

  /** Loads a song muted, lets it buffer, then parks it paused at its start point. */
  private prepare(d: Deck, index: number, from: number, videoIdx = 0) {
    const entry = this.set?.entries[index];
    const videoId = entry?.song.media.youtube[videoIdx];
    if (!entry || !videoId || !d.player) {
      d.status = "empty";
      d.entry = null;
      return;
    }
    this.clearTimer(d);
    d.entry = index;
    d.videoIdx = videoIdx;
    d.from = from;
    d.status = "loading";
    d.player.mute();
    d.player.setVolume(0);
    d.player.loadVideoById({ videoId, startSeconds: from });
    d.loadTimer = window.setTimeout(() => {
      this.emitter.log(`Deck ${d.id}: "${entry.song.title}" did not load in time.`);
      this.nextSource(d);
    }, LOAD_TIMEOUT_MS);
  }

  private nextSource(d: Deck) {
    this.clearTimer(d);
    if (d.entry === null || !this.set) return;
    const entry = this.set.entries[d.entry];
    if (!entry) return;
    if (d.videoIdx + 1 < entry.song.media.youtube.length) {
      this.emitter.log(`Deck ${d.id}: trying backup video ${d.videoIdx + 2} for "${entry.song.title}".`);
      this.prepare(d, d.entry, d.from, d.videoIdx + 1);
      return;
    }
    this.emitter.log(`Skipping "${entry.song.title}": no playable video.`);
    const skipped = [...this.emitter.get().skipped, d.entry];
    this.emitter.update({ skipped }, true);
    const nextIndex = d.entry + 1;
    const wasLive = d.status === "live" || this.live === d.id && this.emitter.get().status === "loading";
    d.status = "empty";
    d.entry = null;
    if (nextIndex >= this.set.entries.length) {
      if (wasLive) this.finish("End of the set.");
      return;
    }
    // The skipped song's planned handover no longer applies; start the next one at its hook.
    const from = this.set.entries[nextIndex]?.start ?? 0;
    this.prepare(d, nextIndex, from);
    if (wasLive) this.emitter.update({ index: nextIndex }, true);
  }

  private onState(d: Deck, state: number) {
    if (this.destroyed) return;
    const S = YT.PlayerState;
    if (state === S.PLAYING && d.status === "loading") {
      this.clearTimer(d);
      if (this.live === d.id && this.emitter.get().status === "loading") {
        // First song of the set: go live straight away.
        d.status = "live";
        d.player?.unMute();
        d.player?.setVolume(Math.round(100 * this.master));
        if (Math.abs((d.player?.getCurrentTime() ?? 0) - d.from) > 1) d.player?.seekTo(d.from, true);
        this.emitter.update({ status: "playing", index: d.entry ?? 0 }, true);
        this.emitter.log(`Live: ${this.title(d.entry)}`);
        this.preloadNext();
        return;
      }
      d.player?.pauseVideo();
      d.player?.seekTo(d.from, true);
      d.status = "ready";
      this.emitter.update({ nextReady: true }, true);
      this.emitter.log(`Deck ${d.id} ready: ${this.title(d.entry)}`);
      return;
    }
    if (state === S.PLAYING && d.status === "starting" && this.trans?.to === d) {
      this.clearTimer(d);
      const measured = (performance.now() - d.triggeredAt) / 1000;
      this.latency = Math.min(1.5, Math.max(0.05, this.latency * 0.6 + measured * 0.4));
      this.trans.incomingPlaying = true;
      if (this.trans.plan.kind === "cut") this.complete();
      return;
    }
    if (state === S.ENDED && d.status === "live" && !this.trans) {
      const next = this.otherDeck(d.id);
      if (next.status === "ready") {
        const t = d.player?.getCurrentTime() ?? 0;
        this.begin(d, next, { kind: "cut", outAt: t, inFrom: next.from, inAlign: next.from, overlap: 0, rate: 1, why: "Song ended" }, t);
      } else if (next.status === "empty") {
        this.finish("End of the set.");
      } else {
        this.forceHandoffWhenReady = true;
      }
    }
  }

  private onError(d: Deck, code: number) {
    // 2 bad id, 5 HTML5 error, 100 removed or private, 101/150 embedding disabled by the owner.
    this.emitter.log(`Deck ${d.id}: YouTube error ${code} on ${this.title(d.entry)}.`);
    if (d.status === "live" && this.trans === null) {
      // The live song broke mid-play: hand over to the next song as soon as it can play.
      const next = this.otherDeck(d.id);
      if (next.status === "ready") {
        this.begin(d, next, { kind: "cut", outAt: 0, inFrom: next.from, inAlign: next.from, overlap: 0, rate: 1, why: "Error" }, 0);
      } else if (next.status === "loading") {
        this.forceHandoffWhenReady = true;
      } else {
        this.finish("Stopped: the last song could not be played.");
      }
      return;
    }
    if (this.trans?.to === d) this.abandonIncoming();
    this.nextSource(d);
  }

  private title(index: number | null): string {
    if (index === null || !this.set) return "(nothing)";
    const s = this.set.entries[index]?.song;
    return s ? `"${s.title}" by ${s.artist}` : "(nothing)";
  }

  private preloadNext() {
    const live = this.liveDeck();
    if (!live || live.entry === null || !this.set) return;
    const nextIndex = live.entry + 1;
    const other = this.otherDeck(live.id);
    if (nextIndex >= this.set.entries.length) {
      other.status = "empty";
      this.emitter.update({ nextReady: false });
      return;
    }
    const plan = this.set.entries[live.entry]?.transition;
    const from = plan ? Math.max(0, plan.inFrom) : (this.set.entries[nextIndex]?.start ?? 0);
    this.emitter.update({ nextReady: false });
    this.prepare(other, nextIndex, from);
  }

  private onTick() {
    if (this.paused || this.destroyed || !this.set) return;
    const live = this.liveDeck();
    if (!live || !live.player || live.status !== "live") return;
    const t = live.player.getCurrentTime();
    this.emitter.update({ position: t, index: live.entry ?? 0, transitioning: !!this.trans });

    if (this.trans) {
      this.updateFade(t);
      return;
    }
    if (this.ending) return;
    const entry = live.entry !== null ? this.set.entries[live.entry] : undefined;
    if (!entry) return;
    const next = this.otherDeck(live.id);

    if (this.forceHandoffWhenReady && next.status === "ready") {
      this.forceHandoffWhenReady = false;
      this.begin(live, next, { kind: "fade", outAt: t + 1.5, inFrom: next.from, inAlign: next.from + 1.5, overlap: 1.5, rate: 1, why: "Skipped" }, t);
      return;
    }
    if (this.holding) return;

    const plan = entry.transition;
    if (!plan) {
      if (t >= entry.end) this.endSet(live);
      return;
    }
    // Skipped songs shift the set: the planned handover only applies if the next deck holds the planned song.
    const planned = next.entry === (live.entry ?? -1) + 1;
    const effective: TransitionPlan = planned ? plan : { ...plan, kind: "fade", overlap: 1.5, inFrom: next.from, inAlign: next.from + 1.5 };
    const startPos = effective.kind === "cut" ? effective.outAt : effective.outAt - effective.overlap;
    if (t < startPos - this.latency) return;
    if (next.status === "ready") {
      this.waitingSince = 0;
      this.begin(live, next, effective, startPos);
    } else if (next.status === "loading" && this.waitingSince === 0) {
      this.waitingSince = performance.now();
      this.emitter.log("Next song still buffering; letting this one run on.");
    } else if (next.status === "empty" && t >= entry.end) {
      this.endSet(live);
    }
  }

  private begin(from: Deck, to: Deck, plan: TransitionPlan, startPos: number) {
    if (!to.player) return;
    this.trans = { plan, from, to, startPos, incomingPlaying: false, corrected: false };
    to.status = "starting";
    to.triggeredAt = performance.now();
    to.player.setVolume(plan.kind === "cut" ? Math.round(100 * this.master) : 0);
    to.player.unMute();
    to.player.playVideo();
    this.clearTimer(to);
    to.loadTimer = window.setTimeout(() => {
      if (this.trans?.to !== to || this.trans.incomingPlaying) return;
      this.emitter.log(`Deck ${to.id} did not start; skipping that song.`);
      this.abandonIncoming();
      this.nextSource(to);
    }, START_TIMEOUT_MS);
    this.emitter.update({ transitioning: true }, true);
    const outPos = from.player?.getCurrentTime() ?? 0;
    this.emitter.log(`${plan.kind === "blend" ? "Blending" : plan.kind === "cut" ? "Cutting" : "Fading"} into ${this.title(to.entry)} (outgoing at ${outPos.toFixed(2)}s, planned ${(startPos - this.latency).toFixed(2)}s). ${plan.why}`);
  }

  /** The incoming song failed mid-transition: silence it and bring the outgoing back to full. */
  private abandonIncoming() {
    const tr = this.trans;
    if (!tr) return;
    this.trans = null;
    tr.to.player?.mute();
    tr.to.player?.pauseVideo();
    tr.to.status = "loading";
    tr.from.player?.setVolume(Math.round(100 * this.master));
    this.emitter.update({ transitioning: false }, true);
  }

  private updateFade(t: number) {
    const tr = this.trans;
    if (!tr || !tr.from.player || !tr.to.player) return;
    if (tr.plan.kind === "cut") return; // completed on the PLAYING event
    if (!tr.incomingPlaying) return; // keep the outgoing at full until the incoming is audible
    const p = (t - tr.startPos) / Math.max(0.1, tr.plan.overlap);
    // One early correction: nudge the incoming video so its hook lands on the outgoing phrase end.
    if (!tr.corrected && tr.plan.kind === "blend") {
      tr.corrected = true;
      const expected = tr.plan.inFrom + (t - tr.startPos);
      const actual = tr.to.player.getCurrentTime();
      if (Math.abs(actual - expected) > 0.08) tr.to.player.seekTo(expected + 0.1, true);
    }
    const g = fadeGains(tr.plan.kind, p);
    tr.to.player.setVolume(Math.round(100 * this.master * g.incoming));
    tr.from.player.setVolume(Math.round(100 * this.master * g.outgoing));
    if (p >= 1) this.complete();
  }

  private complete() {
    const tr = this.trans;
    if (!tr) return;
    this.clearTimer(tr.to);
    tr.to.player?.setVolume(Math.round(100 * this.master));
    tr.from.player?.pauseVideo();
    tr.from.player?.mute();
    tr.from.status = "empty";
    tr.from.entry = null;
    tr.to.status = "live";
    this.live = tr.to.id;
    this.trans = null;
    this.holding = false;
    this.opts.onLiveDeck?.(tr.to.id);
    this.emitter.update({ index: tr.to.entry ?? 0, transitioning: false, holding: false, nextReady: false }, true);
    const inPos = tr.to.player?.getCurrentTime() ?? 0;
    this.emitter.log(`Live: ${this.title(tr.to.entry)} (at ${inPos.toFixed(2)}s, hook planned at ${tr.plan.inAlign.toFixed(2)}s, start latency ${Math.round(this.latency * 1000)} ms)`);
    this.preloadNext();
  }

  private endSet(d: Deck) {
    this.ending = true;
    const startedAt = performance.now();
    const fade = window.setInterval(() => {
      if (this.paused) return;
      const p = Math.min(1, (performance.now() - startedAt) / 4000);
      d.player?.setVolume(Math.round(100 * this.master * Math.cos((p * Math.PI) / 2)));
      if (p >= 1) {
        window.clearInterval(fade);
        d.player?.pauseVideo();
        this.finish("End of the set.");
      }
    }, 40);
  }

  private finish(message: string) {
    if (this.tick !== null) window.clearInterval(this.tick);
    this.tick = null;
    this.emitter.update({ status: "finished", transitioning: false, message }, true);
    this.emitter.log(message);
  }
}
