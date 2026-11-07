import { useEffect, useRef } from "react";
import type { LocalEngine } from "../lib/local/LocalEngine";

/** Milkdrop-style visuals (Butterchurn) that react to the mix, for songs without a video. */
export function Visualizer({ engine }: { engine: LocalEngine }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let cycle = 0;
    let cancelled = false;
    const el = canvas.current;
    const ctx = engine.audioContext;
    const out = engine.output;
    if (!el || !ctx || !out) return;
    void (async () => {
      const [{ default: butterchurn }, { default: presetsPkg }] = await Promise.all([import("butterchurn"), import("butterchurn-presets")]);
      if (cancelled) return;
      const rect = el.getBoundingClientRect();
      el.width = Math.max(320, Math.round(rect.width));
      el.height = Math.max(180, Math.round(rect.height));
      const viz = butterchurn.createVisualizer(ctx, el, { width: el.width, height: el.height, pixelRatio: Math.min(2, window.devicePixelRatio) });
      viz.connectAudio(out);
      const presets = Object.values(presetsPkg.getPresets());
      const next = () => viz.loadPreset(presets[Math.floor(Math.random() * presets.length)], 2.5);
      next();
      cycle = window.setInterval(next, 30000);
      const draw = () => {
        viz.render();
        raf = requestAnimationFrame(draw);
      };
      draw();
    })().catch((e) => console.warn("[DJmaxing] Visuals unavailable:", e));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearInterval(cycle);
    };
  }, [engine]);

  return <canvas ref={canvas} aria-label="Music visuals" style={{ zIndex: 1 }} />;
}
