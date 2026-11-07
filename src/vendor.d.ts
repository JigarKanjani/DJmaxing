// Minimal type declarations for packages that ship without them.

declare module "signalsmith-stretch" {
  export interface StretchSchedule {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    loopStart?: number;
    loopEnd?: number;
  }
  export interface SignalsmithStretchNode extends AudioNode {
    inputTime: number;
    schedule(change: StretchSchedule): void;
    start(when?: number, offset?: number, duration?: number, rate?: number, semitones?: number): void;
    stop(when?: number): void;
    addBuffers(channels: Float32Array[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<unknown>;
    latency(): number;
    setUpdateInterval(seconds: number, callback?: (time: number) => void): Promise<unknown>;
  }
  export default function SignalsmithStretch(context: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<SignalsmithStretchNode>;
}

declare module "butterchurn" {
  export interface Visualizer {
    connectAudio(node: AudioNode): void;
    loadPreset(preset: unknown, blendSeconds: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
  }
  const butterchurn: { createVisualizer(ctx: AudioContext, canvas: HTMLCanvasElement, opts: { width: number; height: number; pixelRatio?: number }): Visualizer };
  export default butterchurn;
}

declare module "butterchurn-presets" {
  const presets: { getPresets(): Record<string, unknown> };
  export default presets;
}
