import type { BuiltSet } from "../lib/types";

export function formatTime(s: number): string {
  if (!Number.isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const KIND_LABEL = { blend: "Blend", cut: "Cut", fade: "Fade" } as const;

export function SetList({ set, liveIndex, skipped = [] }: { set: BuiltSet; liveIndex?: number; skipped?: number[] }) {
  return (
    <ol className="setlist" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {set.entries.map((e, i) => {
        const s = e.song;
        const untimed = !s.hook;
        return (
          <li key={`${s.id}-${i}`} className={`set-row${i === liveIndex ? " live" : ""}`} style={skipped.includes(i) ? { opacity: 0.4 } : undefined}>
            <span className="n">{String(i + 1).padStart(2, "0")}</span>
            <span className="t">
              <b>{s.title}</b>
              <span>
                {s.artist}
                {s.bpm ? ` · ${Math.round(s.bpm)} BPM` : ""}
                {s.camelot ? ` · ${s.camelot}` : ""} · <span className="num">{formatTime(e.start)}</span>
                {untimed && <span title="No hook marked yet: starts at 30 seconds"> · untimed</span>}
              </span>
            </span>
            <span className="meter" title={`Energy ${s.energy}, target ${e.targetEnergy.toFixed(1)}`}>
              <span className="small muted">
                Energy <span className="num">{s.energy}</span>
              </span>
              <span className="bar">
                <span className="fill" style={{ width: `${s.energy * 10}%` }} />
                <span className="target" style={{ left: `${e.targetEnergy * 10}%` }} />
              </span>
            </span>
            <span className="tr">
              {e.transition ? (
                <span className={`tag ${e.transition.kind}`} title={e.transition.why}>
                  <span className="dot" />
                  {KIND_LABEL[e.transition.kind]}
                  {e.transition.overlap > 0 ? ` ${e.transition.overlap.toFixed(1)}s` : ""}
                </span>
              ) : (
                <span className="tag">End</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
