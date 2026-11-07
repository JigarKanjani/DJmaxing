// A "voice" plays one decoded song into the Web Audio graph and can change tempo on a schedule.
// StretchVoice keeps the pitch when the tempo changes (Signalsmith Stretch, WebAssembly).
// BufferVoice is the fallback: it changes tempo like a turntable, so pitch moves slightly.

import SignalsmithStretch, { type SignalsmithStretchNode } from "signalsmith-stretch";

interface Segment {
  /** AudioContext time the segment starts. */
  at: number;
  /** Song position at that time. */
  pos: number;
  rate: number;
}

export interface Voice {
  readonly output: AudioNode;
  readonly keyLock: boolean;
  /** Start playing `offset` seconds into the song at context time `when`. */
  start(when: number, offset: number, rate: number): void;
  setRate(when: number, rate: number): void;
  stop(when: number): void;
  /** Song position at a given context time, from the schedule. */
  positionAt(time: number): number;
  /** Context time at which the song reaches a given position, assuming no further rate changes. */
  timeAtPosition(pos: number): number;
  rateAt(time: number): number;
  dispose(): void;
}

abstract class ScheduledVoice {
  protected segments: Segment[] = [];
  protected stopAt = Number.POSITIVE_INFINITY;

  protected record(at: number, pos: number, rate: number) {
    this.segments = this.segments.filter((s) => s.at < at);
    this.segments.push({ at, pos, rate });
  }

  private segmentAt(time: number): Segment | undefined {
    let found: Segment | undefined;
    for (const s of this.segments) if (s.at <= time) found = s;
    return found ?? this.segments[0];
  }

  positionAt(time: number): number {
    const s = this.segmentAt(time);
    if (!s) return 0;
    const t = Math.min(time, this.stopAt);
    return s.pos + Math.max(0, t - s.at) * s.rate;
  }

  rateAt(time: number): number {
    return this.segmentAt(time)?.rate ?? 1;
  }

  timeAtPosition(pos: number): number {
    // Positions only move forward, so walk back to the segment that contains this position.
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (s && pos >= s.pos) return s.at + (pos - s.pos) / s.rate;
    }
    const first = this.segments[0];
    return first ? first.at + (pos - first.pos) / first.rate : Number.POSITIVE_INFINITY;
  }

  protected positionForChange(when: number): number {
    return this.positionAt(when);
  }
}

export class StretchVoice extends ScheduledVoice implements Voice {
  readonly keyLock = true;
  private constructor(private node: SignalsmithStretchNode) {
    super();
  }

  static async create(ctx: AudioContext, buffer: AudioBuffer): Promise<StretchVoice> {
    const node = await SignalsmithStretch(ctx);
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c).slice());
    if (channels.length === 1 && channels[0]) channels.push(channels[0]);
    await node.addBuffers(channels);
    return new StretchVoice(node);
  }

  get output(): AudioNode {
    return this.node;
  }

  start(when: number, offset: number, rate: number) {
    this.record(when, offset, rate);
    this.node.schedule({ output: when, active: true, input: offset, rate, semitones: 0 });
  }

  setRate(when: number, rate: number) {
    const pos = this.positionForChange(when);
    this.record(when, pos, rate);
    this.node.schedule({ output: when, active: true, input: pos, rate, semitones: 0 });
  }

  stop(when: number) {
    this.stopAt = when;
    this.node.schedule({ output: when, active: false });
  }

  dispose() {
    try {
      this.node.disconnect();
      void this.node.dropBuffers();
    } catch {
      // Already gone.
    }
  }
}

export class BufferVoice extends ScheduledVoice implements Voice {
  readonly keyLock = false;
  private source: AudioBufferSourceNode;
  private gain: GainNode;

  constructor(private ctx: AudioContext, buffer: AudioBuffer) {
    super();
    this.source = ctx.createBufferSource();
    this.source.buffer = buffer;
    this.gain = ctx.createGain();
    this.source.connect(this.gain);
  }

  get output(): AudioNode {
    return this.gain;
  }

  start(when: number, offset: number, rate: number) {
    this.record(when, offset, rate);
    this.source.playbackRate.setValueAtTime(rate, when);
    this.source.start(Math.max(when, this.ctx.currentTime), Math.max(0, offset));
  }

  setRate(when: number, rate: number) {
    const pos = this.positionForChange(when);
    this.record(when, pos, rate);
    this.source.playbackRate.setValueAtTime(rate, when);
  }

  stop(when: number) {
    this.stopAt = when;
    try {
      this.source.stop(when);
    } catch {
      // Not started.
    }
  }

  dispose() {
    try {
      this.source.disconnect();
      this.gain.disconnect();
    } catch {
      // Already gone.
    }
  }
}

let stretchWorks: boolean | null = null;

/** Prefers the key-locked stretcher; falls back to plain playback if WebAssembly worklets fail. */
export async function createVoice(ctx: AudioContext, buffer: AudioBuffer): Promise<Voice> {
  if (stretchWorks !== false) {
    try {
      const v = await StretchVoice.create(ctx, buffer);
      stretchWorks = true;
      return v;
    } catch (e) {
      console.warn("[DJmaxing] Signalsmith Stretch unavailable, using plain playback:", e);
      stretchWorks = false;
    }
  }
  return new BufferVoice(ctx, buffer);
}
