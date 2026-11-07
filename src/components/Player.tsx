import { useEffect, useRef, useState } from "react";
import { emptySnapshot, type Engine, type EngineSnapshot } from "../lib/engine";
import { LocalEngine } from "../lib/local/LocalEngine";
import type { BuiltSet, Room } from "../lib/types";
import { YouTubeEngine } from "../lib/youtube/YouTubeEngine";
import { formatTime, SetList } from "./SetList";
import { Visualizer } from "./Visualizer";

export interface PlayerProps {
  set: BuiltSet;
  playback: Room["playback"];
  files: Map<string, File>;
  onExit: () => void;
}

type DeckId = "A" | "B";

export function Player({ set, playback, files, onExit }: PlayerProps) {
  const hostA = useRef<HTMLDivElement>(null);
  const hostB = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot>(emptySnapshot);
  const [liveDeck, setLiveDeck] = useState<DeckId>("A");
  const [ready, setReady] = useState(playback === "local");
  const [initError, setInitError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const [showVisuals, setShowVisuals] = useState(false);

  useEffect(() => {
    if (!hostA.current || !hostB.current) return;
    const common = { hostA: hostA.current, hostB: hostB.current, onLiveDeck: setLiveDeck };
    const engine: Engine = playback === "youtube" ? new YouTubeEngine(common) : new LocalEngine({ ...common, files });
    engineRef.current = engine;
    const unsub = engine.subscribe(setSnap);
    if (engine instanceof YouTubeEngine) {
      // Create both players now, so pressing Play starts the music inside the click.
      engine
        .init()
        .then(() => setReady(true))
        .catch((e: Error) => setInitError(e.message));
    }
    return () => {
      unsub();
      engine.destroy();
      engineRef.current = null;
    };
  }, [playback, files]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const engine = engineRef.current;
      if (!engine) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (snap.status === "playing") engine.pause();
        else if (snap.status === "paused") engine.resume();
      } else if (e.key === "n" || e.key === "ArrowRight") engine.skip();
      else if (e.key === "h") engine.hold(!snap.holding);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap.status, snap.holding]);

  // Keep the screen awake while the party plays, so the laptop or TV never sleeps mid-set.
  useEffect(() => {
    if (snap.status !== "playing" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => undefined);
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => undefined);
    };
  }, [snap.status]);

  const stageRef = useRef<HTMLDivElement>(null);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen().catch(() => undefined);
  };

  const start = (from = 0) => {
    void engineRef.current?.start(set, from).catch((e: Error) => setInitError(e.message));
  };

  const live = set.entries[snap.index];
  const next = set.entries[snap.index + 1];
  const progress = live ? Math.min(1, Math.max(0, (snap.position - live.start) / Math.max(1, live.end - live.start))) : 0;
  const started = snap.status !== "idle";
  const localEngine = engineRef.current instanceof LocalEngine ? engineRef.current : null;
  const visualsActive = !!localEngine && started && (showVisuals || !localEngine.liveHasVideo());

  const deckClass = (id: DeckId) => `deck ${liveDeck === id ? "live" : "next"}`;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row spread">
        <button type="button" className="btn ghost" onClick={onExit}>
          Back to the set
        </button>
        <span className="muted small">
          Keys: <span className="kbd">Space</span> pause, <span className="kbd">N</span> next, <span className="kbd">H</span> hold this song
        </span>
      </div>
      {initError && <div className="notice error">{initError}</div>}
      <div className="stage" ref={stageRef}>
        <div className="decks">
          {/* Both decks stay visible: YouTube's rules do not allow hidden or background players. */}
          <div className={deckClass("A")} style={{ order: liveDeck === "A" ? 0 : 1 }}>
            <span className="deck-label">{liveDeck === "A" ? "LIVE" : "UP NEXT"}</span>
            <div ref={hostA} style={{ position: "absolute", inset: 0 }} />
            {visualsActive && liveDeck === "A" && localEngine && <Visualizer engine={localEngine} />}
          </div>
          <div className={deckClass("B")} style={{ order: liveDeck === "B" ? 0 : 1 }}>
            <span className="deck-label">{liveDeck === "B" ? "LIVE" : "UP NEXT"}</span>
            <div ref={hostB} style={{ position: "absolute", inset: 0 }} />
            {visualsActive && liveDeck === "B" && localEngine && <Visualizer engine={localEngine} />}
          </div>
        </div>
        <aside className="panel now" aria-live="polite">
          {!started ? (
            <>
              <h2>Ready when you are</h2>
              <p className="muted">
                {set.entries.length} songs, about {Math.round(set.seconds / 60)} minutes. Connect the speakers, then press play.
              </p>
              <button type="button" className="btn pink big" disabled={!ready} onClick={() => start(0)}>
                {ready ? "Play" : "Loading players..."}
              </button>
            </>
          ) : (
            <>
              <span className="label">{snap.status === "paused" ? "Paused" : snap.status === "finished" ? "Finished" : snap.transitioning ? "Mixing" : "Now playing"}</span>
              <div>
                <div className="title">{live?.song.title ?? ""}</div>
                <div className="muted">{live?.song.artist}</div>
              </div>
              <div className="progress" aria-hidden="true">
                <span className="fill" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="row spread small muted num">
                <span>{formatTime(snap.position)}</span>
                <span>{live ? `hands over at ${formatTime(live.end)}` : ""}</span>
              </div>
              {live?.transition && next && (
                <div className="notice small">
                  <b>Next: {next.song.title}</b>
                  <br />
                  {snap.holding ? "Holding this song to its end." : live.transition.why}
                  {!snap.nextReady && !snap.transitioning ? " Loading..." : ""}
                </div>
              )}
              <div className="controls">
                {snap.status === "paused" ? (
                  <button type="button" className="btn primary" onClick={() => engineRef.current?.resume()}>
                    Resume
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={() => engineRef.current?.pause()} disabled={snap.status !== "playing"}>
                    Pause
                  </button>
                )}
                <button type="button" className="btn" onClick={() => engineRef.current?.skip()} disabled={!next || snap.status !== "playing"}>
                  Next song
                </button>
                <button type="button" className="btn" aria-pressed={snap.holding} onClick={() => engineRef.current?.hold(!snap.holding)}>
                  {snap.holding ? "Release" : "Hold this song"}
                </button>
                <button type="button" className="btn ghost" onClick={fullscreen} title="Full screen for a TV or projector">
                  Full screen
                </button>
                {snap.status === "finished" && (
                  <button type="button" className="btn primary" onClick={() => start(0)}>
                    Play again
                  </button>
                )}
              </div>
              <div className="field">
                <label className="label" htmlFor="vol">
                  Volume
                </label>
                <input
                  id="vol"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    engineRef.current?.setMasterVolume(v);
                  }}
                />
              </div>
              {localEngine && (
                <label className="row small">
                  <input type="checkbox" checked={showVisuals} onChange={(e) => setShowVisuals(e.target.checked)} /> Show visuals over videos too
                </label>
              )}
              {snap.message && <div className="notice">{snap.message}</div>}
            </>
          )}
        </aside>
      </div>
      <SetList set={set} liveIndex={started ? snap.index : undefined} skipped={snap.skipped} />
      <details>
        <summary className="muted small">Mix log</summary>
        <div className="log">{snap.log.join("\n") || "Nothing yet."}</div>
      </details>
    </div>
  );
}
