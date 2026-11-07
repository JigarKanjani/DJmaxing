import { useMemo, useState } from "react";
import { blankSong, libraryJson, parseImport, parseYouTubeId } from "../lib/library";
import { LANGUAGES, type Language, type Song } from "../lib/types";
import { Curator } from "./Curator";
import { LANG_LABEL, MOOD_LABEL } from "./RoomForm";

interface SearchHit {
  id: string;
  title: string;
  channel: string;
  thumbnail: string | null;
}

export interface LibraryProps {
  songs: Song[];
  localIds: Set<string>;
  files: Map<string, File>;
  onSave: (songs: Song[]) => void;
  onRemoveLocal: (id: string) => void;
  onResetLocal: () => void;
  onToast: (m: string) => void;
}

/** YouTube returns titles with HTML entities (&#39;). Decode them as text, never as markup. */
function decodeEntities(s: string): string {
  return new DOMParser().parseFromString(s, "text/html").documentElement.textContent ?? s;
}

function status(s: Song): { text: string; cls: string } {
  if (s.analysis.verified) return { text: "Checked", cls: "blend" };
  if (s.hook && s.bpm) return { text: s.analysis.source === "analyzer" ? "Analysed" : "Timed", cls: "fade" };
  return { text: "Needs timing", cls: "warn" };
}

export function Library({ songs, localIds, files, onSave, onRemoveLocal, onResetLocal, onToast }: LibraryProps) {
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<Language | "">("");
  const [needsTiming, setNeedsTiming] = useState(false);
  const [editing, setEditing] = useState<Song | null>(null);
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [language, setLanguage] = useState<Language>("hindi");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return songs
      .filter((s) => (!lang || s.language === lang) && (!needsTiming || !s.hook) && (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [songs, query, lang, needsTiming]);
  const untimed = songs.filter((s) => !s.hook).length;

  const add = () => {
    const id = parseYouTubeId(link);
    if (!id) return onToast("Paste a YouTube link, or search for the song.");
    if (!title.trim() || !artist.trim()) return onToast("Add the song title and artist.");
    const song = blankSong({ title: title.trim(), artist: artist.trim(), language, media: { youtube: [id], file: null, spotifyUri: null } });
    if (songs.some((s) => s.id === song.id)) return onToast("That song is already in the library.");
    onSave([song]);
    setLink("");
    setTitle("");
    setArtist("");
    setHits(null);
    setEditing(song);
  };

  const search = async () => {
    const q = `${title} ${artist}`.trim();
    if (!q) return onToast("Type a title or artist to search.");
    setSearching(true);
    try {
      const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(q + " official video")}`);
      if (res.status === 404 || res.status === 501) {
        onToast("YouTube search is not set up on this deployment. Paste a link instead (see Set up).");
        return;
      }
      if (!res.ok) throw new Error(`Search failed (${res.status}).`);
      setHits(((await res.json()) as { results: SearchHit[] }).results);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const download = () => {
    const blob = new Blob([libraryJson(songs)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "library.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseImport(await f.text());
    if (r.songs.length) onSave(r.songs);
    onToast(`Imported ${r.songs.length} songs${r.errors.length ? `, skipped ${r.errors.length} problems (see console)` : ""}.`);
    if (r.errors.length) console.warn("[DJmaxing] Import problems:", r.errors);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel" aria-labelledby="add-h">
        <h2 id="add-h">Add a song</h2>
        <div className="grid-2" style={{ gap: 12 }}>
          <label className="field">
            <span className="label">Title</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Artist</span>
            <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">YouTube link (use the official video)</span>
            <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
          </label>
          <label className="field">
            <span className="label">Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANG_LABEL[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button type="button" className="btn primary" onClick={add}>
            Add and time it
          </button>
          <button type="button" className="btn" onClick={search} disabled={searching}>
            {searching ? "Searching..." : "Search YouTube"}
          </button>
        </div>
        {hits && (
          <div className="stack">
            {hits.length === 0 && <span className="muted">No embeddable videos found.</span>}
            {hits.map((h) => (
              <button key={h.id} type="button" className="btn ghost" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => setLink(`https://www.youtube.com/watch?v=${h.id}`)}>
                {h.thumbnail && <img src={h.thumbnail} alt="" width={96} height={54} style={{ borderRadius: 6, objectFit: "cover" }} />}
                <span>
                  <b>{decodeEntities(h.title)}</b>
                  <br />
                  <span className="muted small">{h.channel}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="lib-h">
        <div className="row spread">
          <h2 id="lib-h">
            Library <span className="muted num">{songs.length}</span>
          </h2>
          <div className="row">
            <label className="btn">
              Import JSON
              <input type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
            </label>
            <button type="button" className="btn" onClick={download}>
              Export JSON
            </button>
            {localIds.size > 0 &&
              (confirmReset ? (
                <>
                  <button type="button" className="btn danger" onClick={() => (onResetLocal(), setConfirmReset(false))}>
                    Yes, remove {localIds.size} local edits
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmReset(false)}>
                    Keep them
                  </button>
                </>
              ) : (
                <button type="button" className="btn ghost" onClick={() => setConfirmReset(true)}>
                  Reset local edits
                </button>
              ))}
          </div>
        </div>
        {untimed > 0 && (
          <div className="notice small">
            {untimed} songs have no hook marked yet, so they start 30 seconds in and use short fades. Open one, tap along, and mark the hook.
            Edits are saved in this browser; use Export JSON to back them up or to commit them to <span className="mono">public/library.json</span>.
          </div>
        )}
        <div className="row">
          <input type="search" placeholder="Search title or artist" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 320 }} />
          <select value={lang} onChange={(e) => setLang(e.target.value as Language | "")} style={{ maxWidth: 180 }}>
            <option value="">All languages</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANG_LABEL[l]}
              </option>
            ))}
          </select>
          <button type="button" className="chip" aria-pressed={needsTiming} onClick={() => setNeedsTiming(!needsTiming)}>
            Needs timing
          </button>
        </div>
        <div className="lib-table" role="table" aria-label="Songs">
          <div className="lib-row head" role="row">
            <span>Song</span>
            <span>Language</span>
            <span>Moods</span>
            <span>Energy</span>
            <span>BPM / key</span>
            <span>Status</span>
            <span />
          </div>
          {shown.map((s) => {
            const st = status(s);
            return (
              <div key={s.id} className="lib-row" role="row">
                <span className="t">
                  <b>{s.title}</b>
                  <span className="muted small">{s.artist}</span>
                </span>
                <span className="small">{LANG_LABEL[s.language]}</span>
                <span className="small muted">{s.moods.slice(0, 2).map((m) => MOOD_LABEL[m]).join(", ")}</span>
                <span className="num">{s.energy}</span>
                <span className="num small">
                  {s.bpm ? Math.round(s.bpm) : "--"} / {s.camelot ?? "--"}
                </span>
                <span>
                  <span className={`tag ${st.cls}`}>{st.text}</span>
                  {localIds.has(s.id) && <span className="muted small"> edited</span>}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn" onClick={() => setEditing(s)}>
                    Edit
                  </button>
                  {localIds.has(s.id) && (
                    <button type="button" className="btn ghost small" title="Undo local edits to this song" onClick={() => onRemoveLocal(s.id)}>
                      Undo
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      {editing && <Curator key={editing.id} song={editing} files={files} onSave={(s) => onSave([s])} onClose={() => setEditing(null)} />}
    </div>
  );
}
