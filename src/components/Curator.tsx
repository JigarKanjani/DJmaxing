import { useCallback, useEffect, useRef, useState } from "react";
import { compatibleKeys } from "../lib/brain/camelot";
import { barSeconds, snapToBar } from "../lib/brain/grid";
import { parseYouTubeId, validateSong } from "../lib/library";
import { resolveFile } from "../lib/local/LocalEngine";
import { beatAt, fitTaps, normaliseDownbeat } from "../lib/tap";
import { mediaTransport, youtubeTransport, type Transport } from "../lib/transport";
import { LANGUAGES, MOODS, type Song } from "../lib/types";
import { LANG_LABEL, MOOD_LABEL } from "./RoomForm";
import { formatTime } from "./SetList";

// Camelot code with the musical key it stands for, for the key picker.
const KEY_NAMES: [string, string][] = [
  ["1A", "A♭ minor"], ["2A", "E♭ minor"], ["3A", "B♭ minor"], ["4A", "F minor"], ["5A", "C minor"], ["6A", "G minor"],
  ["7A", "D minor"], ["8A", "A minor"], ["9A", "E minor"], ["10A", "B minor"], ["11A", "F♯ minor"], ["12A", "D♭ minor"],
  ["1B", "B major"], ["2B", "F♯ major"], ["3B", "D♭ major"], ["4B", "A♭ major"], ["5B", "E♭ major"], ["6B", "B♭ major"],
  ["7B", "F major"], ["8B", "C major"], ["9B", "G major"], ["10B", "D major"], ["11B", "A major"], ["12B", "E major"],
];

export interface CuratorProps {
  song: Song;
  files: Map<string, File>;
  onSave: (song: Song) => void;
  onClose: () => void;
}

export function Curator({ song, files, onSave, onClose }: CuratorProps) {
  const [draft, setDraft] = useState<Song>(song);
  const [taps, setTaps] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(song.durationSec ?? 0);
  const [backupUrl, setBackupUrl] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const transport = useRef<Transport | null>(null);
  const stopAt = useRef<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const file = resolveFile(files, song.media.file);
  const videoId = song.media.youtube[0];

  // Load the player for this song.
  useEffect(() => {
    let disposed = false;
    const el = host.current;
    if (!el) return;
    (async () => {
      try {
        const t = file ? mediaTransport(el, file) : videoId ? await youtubeTransport(el, videoId) : null;
        if (disposed) return t?.destroy();
        if (!t) setError("This song has no YouTube video or picked file to play.");
        transport.current = t;
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      disposed = true;
      transport.current?.destroy();
      transport.current = null;
    };
  }, [file, videoId]);

  // Playhead, duration and preview auto-stop.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = transport.current;
      if (t) {
        const time = t.time();
        setNow(time);
        const d = t.duration();
        if (d > 0) setDuration(d);
        if (stopAt.current !== null && time >= stopAt.current) {
          t.pause();
          stopAt.current = null;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const update = (patch: Partial<Song>) => setDraft((d) => ({ ...d, ...patch }));
  const bpm = draft.bpm ?? null;
  const grid = draft.beatGrid ?? null;

  const tap = useCallback(() => {
    const t = transport.current?.time();
    if (t === undefined) return;
    setTaps((prev) => {
      // A gap of more than two seconds starts a fresh tap run.
      const run = prev.length && t - prev[prev.length - 1]! > 2 ? [] : prev;
      const next = [...run, t].slice(-32);
      const fit = fitTaps(next);
      if (fit && next.length >= 8) {
        const d = draftRef.current;
        setDraft({ ...d, bpm: fit.bpm, beatGrid: d.beatGrid ?? { firstDownbeat: normaliseDownbeat(fit.phase, fit.bpm), beatsPerBar: 4 } });
      }
      return next;
    });
  }, []);

  const markDownbeat = useCallback(() => {
    const t = transport.current?.time();
    const d = draftRef.current;
    if (t === undefined || !d.bpm) {
      setError("Tap the tempo first (T), then press D on the first beat of a bar.");
      return;
    }
    setError(null);
    setDraft({ ...d, beatGrid: { firstDownbeat: normaliseDownbeat(t, d.bpm), beatsPerBar: 4 } });
  }, []);

  const markHook = useCallback((which: "entry" | "exit") => {
    const t = transport.current?.time();
    if (t === undefined) return;
    const d = draftRef.current;
    const snapped = Math.round(snapToBar(d, t) * 1000) / 1000;
    const hook = d.hook ?? { entry: snapped, exit: null };
    if (which === "entry") setDraft({ ...d, hook: { entry: snapped, exit: hook.exit !== null && hook.exit > snapped ? hook.exit : null } });
    else if (snapped > hook.entry) setDraft({ ...d, hook: { entry: hook.entry, exit: snapped } });
    else setError("The hook end must come after its start.");
  }, []);

  const preview = useCallback(() => {
    const d = draftRef.current;
    const t = transport.current;
    if (!t || !d.hook) return;
    const lead = d.bpm ? barSeconds(d.bpm) * 2 : 4; // two bars of run-up
    t.seek(Math.max(0, d.hook.entry - lead));
    stopAt.current = d.hook.exit ?? null;
    t.play();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      const t = transport.current;
      const k = e.key.toLowerCase();
      if (k === "t") tap();
      else if (k === "d") markDownbeat();
      else if (k === "i") markHook("entry");
      else if (k === "o") markHook("exit");
      else if (k === "p") preview();
      else if (e.code === "Space" && t) {
        e.preventDefault();
        if (t.isPlaying()) t.pause();
        else t.play();
      } else if (e.key === "ArrowLeft" && t) t.seek(t.time() - 5);
      else if (e.key === "ArrowRight" && t) t.seek(t.time() + 5);
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap, markDownbeat, markHook, preview, onClose]);

  const save = (verified: boolean) => {
    const timed = !!(draft.hook || draft.bpm);
    const out: Song = {
      ...draft,
      durationSec: draft.durationSec ?? (duration > 0 ? Math.round(duration) : null),
      analysis: { ...draft.analysis, source: timed && draft.analysis.source === "estimate" ? "tap" : draft.analysis.source, verified },
    };
    const errors = validateSong(out);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    onSave(out);
    onClose();
  };

  const beat = bpm && grid ? beatAt(now, bpm, grid.firstDownbeat, grid.beatsPerBar) : null;
  const fit = fitTaps(taps);
  const pct = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`;

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="cur-h" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="row spread">
          <div>
            <h2 id="cur-h">{draft.title}</h2>
            <span className="muted">{draft.artist}</span>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="grid-2" style={{ alignItems: "start" }}>
          <div className="stack" style={{ gap: 12 }}>
            <div className="deck live" ref={host} />
            <div
              className="timeline"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                transport.current?.seek(((e.clientX - r.left) / r.width) * duration);
              }}
              title="Click to jump"
            >
              {draft.hook && <span className="hook" style={{ left: pct(draft.hook.entry), width: `calc(${pct((draft.hook.exit ?? duration) - draft.hook.entry)})` }} />}
              <span className="head" style={{ left: pct(now) }} />
            </div>
            <div className="row spread">
              <span className="num">
                {formatTime(now)} / {formatTime(duration)}
              </span>
              <div className="beat-lights" aria-label={beat ? `Beat ${beat.beat} of bar ${beat.bar}` : "No beat grid yet"}>
                {[1, 2, 3, 4].map((b) => (
                  <span key={b} className={`${beat && beat.beat === b && beat.frac < 0.35 ? "on" : ""}${b === 1 ? " one" : ""}`} />
                ))}
              </div>
            </div>
            <div className="stack small muted">
              <span>
                <span className="kbd">Space</span> play or pause · <span className="kbd">←</span> <span className="kbd">→</span> 5 seconds
              </span>
              <span>
                <span className="kbd">T</span> tap along to the beat (8+ taps) · <span className="kbd">D</span> on the first beat of a bar
              </span>
              <span>
                <span className="kbd">I</span> hook starts here · <span className="kbd">O</span> hand over here · <span className="kbd">P</span> preview the hook
              </span>
              <span>The pink light should flash on every "one". If it drifts, tap again; if it is off by a beat, press D on the one.</span>
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={tap}>Tap</button>
              <button type="button" className="btn" onClick={markDownbeat}>This is the one</button>
              <button type="button" className="btn" onClick={() => markHook("entry")}>Hook starts</button>
              <button type="button" className="btn" onClick={() => markHook("exit")}>Hand over</button>
              <button type="button" className="btn" onClick={preview} disabled={!draft.hook}>Preview</button>
            </div>
          </div>

          <div className="stack" style={{ gap: 14 }}>
            <div className="grid-2" style={{ gap: 10 }}>
              <label className="field">
                <span className="label">Tempo (BPM)</span>
                <input type="number" step="0.01" min={40} max={220} value={draft.bpm ?? ""} onChange={(e) => update({ bpm: e.target.value ? Number(e.target.value) : null })} />
                <span className="muted small">{fit ? `${taps.length} taps, ${fit.jitterMs} ms wobble${fit.jitterMs > 30 ? " (tap more steadily)" : ""}` : "Tap along with T"}</span>
              </label>
              <label className="field">
                <span className="label">Key</span>
                <select value={draft.camelot ?? ""} onChange={(e) => update({ camelot: e.target.value || null })}>
                  <option value="">Unknown</option>
                  {KEY_NAMES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} · {name}
                    </option>
                  ))}
                </select>
                {draft.camelot && <span className="muted small">Mixes well into {compatibleKeys(draft.camelot).slice(1).join(", ")}</span>}
              </label>
              <label className="field">
                <span className="label">First downbeat (s)</span>
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={grid?.firstDownbeat ?? ""}
                  onChange={(e) => update({ beatGrid: e.target.value ? { firstDownbeat: Number(e.target.value), beatsPerBar: 4 } : null })}
                />
              </label>
              <label className="field">
                <span className="label">Hook start / hand over (s)</span>
                <span className="row" style={{ flexWrap: "nowrap" }}>
                  <input type="number" step="0.01" min={0} value={draft.hook?.entry ?? ""} onChange={(e) => update({ hook: e.target.value ? { entry: Number(e.target.value), exit: draft.hook?.exit ?? null } : null })} />
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="end"
                    value={draft.hook?.exit ?? ""}
                    disabled={!draft.hook}
                    onChange={(e) => draft.hook && update({ hook: { entry: draft.hook.entry, exit: e.target.value ? Number(e.target.value) : null } })}
                  />
                </span>
              </label>
            </div>
            <div className="grid-2" style={{ gap: 10 }}>
              <label className="field">
                <span className="label">Energy: {draft.energy}</span>
                <input type="range" min={1} max={10} value={draft.energy} onChange={(e) => update({ energy: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span className="label">How well known</span>
                <select value={draft.fame} onChange={(e) => update({ fame: Number(e.target.value) as 1 | 2 | 3 })}>
                  <option value={3}>Everyone knows it</option>
                  <option value={2}>Most people know it</option>
                  <option value={1}>Deep cut</option>
                </select>
              </label>
              <label className="field">
                <span className="label">Language</span>
                <select value={draft.language} onChange={(e) => update({ language: e.target.value as Song["language"] })}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANG_LABEL[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Year</span>
                <input type="number" min={1940} max={2100} value={draft.year ?? ""} onChange={(e) => update({ year: e.target.value ? Number(e.target.value) : null })} />
              </label>
            </div>
            <div className="field">
              <span className="label">Moods</span>
              <div className="chips">
                {MOODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="chip"
                    aria-pressed={draft.moods.includes(m)}
                    onClick={() => update({ moods: draft.moods.includes(m) ? draft.moods.filter((x) => x !== m) : [...draft.moods, m] })}
                  >
                    {MOOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">YouTube videos (first one plays, the rest are backups)</span>
              <div className="chips">
                {draft.media.youtube.map((id) => (
                  <span key={id} className="tag mono">
                    {id}
                    <button type="button" className="btn ghost small" style={{ padding: "0 4px" }} aria-label={`Remove ${id}`} onClick={() => update({ media: { ...draft.media, youtube: draft.media.youtube.filter((x) => x !== id) } })}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <span className="row" style={{ flexWrap: "nowrap" }}>
                <input type="url" placeholder="Paste a backup YouTube link" value={backupUrl} onChange={(e) => setBackupUrl(e.target.value)} />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const id = parseYouTubeId(backupUrl);
                    if (!id) return setError("That does not look like a YouTube link.");
                    if (!draft.media.youtube.includes(id)) update({ media: { ...draft.media, youtube: [...draft.media.youtube, id] } });
                    setBackupUrl("");
                  }}
                >
                  Add
                </button>
              </span>
            </div>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => save(true)}>
                Save as checked
              </button>
              <button type="button" className="btn" onClick={() => save(draft.analysis.verified)}>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
