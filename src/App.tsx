import { useCallback, useEffect, useMemo, useState } from "react";
import { Help } from "./components/Help";
import { Library } from "./components/Library";
import { Party } from "./components/Party";
import { loadLocalSongs, loadSeedLibrary, mergeSongs, saveLocalSongs } from "./lib/library";
import { completeSignInFromUrl, exportPlaylist, type PendingExport } from "./lib/spotify/spotify";
import type { Song } from "./lib/types";

type View = "party" | "library" | "help";

function viewFromHash(): View {
  const h = window.location.hash.replace("#", "");
  return h === "library" || h === "help" ? h : "party";
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [seed, setSeed] = useState<Song[] | null>(null);
  const [local, setLocal] = useState<Song[]>(loadLocalSongs);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null);

  const songs = useMemo(() => mergeSongs(seed ?? [], local), [seed, local]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    void loadSeedLibrary().then(setSeed);
    void completeSignInFromUrl().then((r) => {
      if (r.error) setToast(r.error);
      else if (r.handled) setToast("Signed in to Spotify.");
      if (r.pending) setPendingExport(r.pending);
    });
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Finish an export the user started before being sent to Spotify to sign in.
  useEffect(() => {
    if (!pendingExport || seed === null) return;
    const byId = new Map(songs.map((s) => [s.id, s]));
    const list = pendingExport.songIds.map((id) => byId.get(id)).filter((s): s is Song => !!s);
    setPendingExport(null);
    setToast(`Saving "${pendingExport.name}" to Spotify...`);
    exportPlaylist(pendingExport.name, list)
      .then((r) => setToast(`Saved ${r.added} songs to Spotify${r.missing.length ? `, ${r.missing.length} not found` : ""}.`))
      .catch((e: Error) => setToast(e.message));
  }, [pendingExport, seed, songs]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const saveSongs = useCallback((changed: Song[]) => {
    setLocal((prev) => {
      const next = mergeSongs(prev, changed);
      saveLocalSongs(next);
      return next;
    });
  }, []);

  const removeLocal = useCallback((id: string) => {
    setLocal((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveLocalSongs(next);
      return next;
    });
  }, []);

  const resetLocal = useCallback(() => {
    setLocal([]);
    saveLocalSongs([]);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>DJmaxing</h1>
        </div>
        <nav className="tabs" aria-label="Sections">
          <a href="#party" aria-current={view === "party" ? "page" : undefined}>Party</a>
          <a href="#library" aria-current={view === "library" ? "page" : undefined}>Library</a>
          <a href="#help" aria-current={view === "help" ? "page" : undefined}>Set up</a>
        </nav>
      </header>
      {seed === null ? (
        <p className="muted">Loading the song library...</p>
      ) : view === "party" ? (
        <Party songs={songs} files={files} onFiles={setFiles} onSaveSongs={saveSongs} onToast={setToast} />
      ) : view === "library" ? (
        <Library songs={songs} localIds={new Set(local.map((s) => s.id))} files={files} onSave={saveSongs} onRemoveLocal={removeLocal} onResetLocal={resetLocal} onToast={setToast} />
      ) : (
        <Help />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
