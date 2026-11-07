import { useState } from "react";
import { beginSignIn, clientId, exportPlaylist, isSignedIn, type ExportResult } from "../lib/spotify/spotify";
import type { BuiltSet } from "../lib/types";

/** Saves the set's song order as a private Spotify playlist, for mixing in Spotify-connected DJ software. */
export function SpotifyExport({ set, onToast }: { set: BuiltSet; onToast: (m: string) => void }) {
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  if (!clientId()) return null;

  const name = `DJmaxing ${new Date().toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}`;
  const run = async () => {
    const songs = set.entries.map((e) => e.song);
    if (!isSignedIn()) {
      await beginSignIn({ name, songIds: songs.map((s) => s.id) });
      return;
    }
    try {
      setProgress("Finding songs on Spotify...");
      const r = await exportPlaylist(name, songs, (d, t) => setProgress(`Finding songs on Spotify: ${d} of ${t}`));
      setResult(r);
      onToast(`Saved ${r.added} songs to Spotify.`);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <span className="row">
      <button type="button" className="btn" onClick={run} disabled={!!progress} title="Saves the song order as a private playlist. Spotify audio is not mixed inside DJmaxing.">
        {progress ?? "Save to Spotify"}
      </button>
      {result?.url && (
        <a href={result.url} target="_blank" rel="noopener noreferrer" className="small">
          Open playlist{result.missing.length ? ` (${result.missing.length} not on Spotify)` : ""}
        </a>
      )}
    </span>
  );
}
