import { useMemo, useState } from "react";
import { buildSet } from "../lib/brain/buildSet";
import { isIOSLike } from "../lib/youtube/loadApi";
import { isMediaFile, quickAnalyze } from "../lib/local/quickAnalyze";
import { resolveFile } from "../lib/local/LocalEngine";
import type { BuiltSet, Room, Song } from "../lib/types";
import { Player } from "./Player";
import { RoomForm } from "./RoomForm";
import { SetList } from "./SetList";
import { SpotifyExport } from "./SpotifyExport";

const ROOM_KEY = "djmaxing.room.v1";

function loadRoom(): Room {
  const fallback: Room = { languages: ["hindi", "punjabi"], moods: [], moment: "peak", crowd: "medium", minutes: 60, playback: "youtube" };
  try {
    const raw = localStorage.getItem(ROOM_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Room>), seed: undefined } : fallback;
  } catch {
    return fallback;
  }
}

export interface PartyProps {
  songs: Song[];
  files: Map<string, File>;
  onFiles: (f: Map<string, File>) => void;
  onSaveSongs: (songs: Song[]) => void;
  onToast: (msg: string) => void;
}

export function Party({ songs, files, onFiles, onSaveSongs, onToast }: PartyProps) {
  const [room, setRoomState] = useState<Room>(loadRoom);
  const [set, setSet] = useState<BuiltSet | null>(null);
  const [playing, setPlaying] = useState(false);
  const [analysing, setAnalysing] = useState<{ done: number; total: number } | null>(null);
  const cutsOnly = useMemo(() => room.playback === "youtube" && isIOSLike(), [room.playback]);

  const setRoom = (r: Room) => {
    setRoomState(r);
    setSet(null);
    try {
      localStorage.setItem(ROOM_KEY, JSON.stringify({ ...r, seed: undefined }));
    } catch {
      // Remembering the room is a convenience only.
    }
  };

  // In local mode only songs whose file is in the picked folder can play.
  const playableSongs = useMemo(() => {
    if (room.playback === "youtube") return songs;
    return songs.filter((s) => s.media.file && resolveFile(files, s.media.file));
  }, [songs, files, room.playback]);

  const unanalysed = useMemo(() => {
    if (room.playback !== "local") return [];
    const known = songs.filter((s) => s.media.file).map((s) => s.media.file!.toLowerCase());
    return [...files.keys()].filter((path) => isMediaFile(path) && !known.some((k) => path.toLowerCase().endsWith(k) || k.endsWith(path.toLowerCase().split("/").slice(1).join("/"))));
  }, [files, songs, room.playback]);

  const build = () => {
    const s = buildSet(playableSongs, { ...room, seed: Date.now() }, { cutsOnly });
    setSet(s);
    if (s.entries.length === 0) onToast("No songs fit this room yet. Pick more languages or add songs in the Library.");
  };

  const pickFolder = (list: FileList | null) => {
    if (!list) return;
    const map = new Map<string, File>();
    for (const f of Array.from(list)) map.set((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, f);
    onFiles(map);
    setSet(null);
  };

  const analyseNew = async () => {
    const added: Song[] = [];
    setAnalysing({ done: 0, total: unanalysed.length });
    for (let i = 0; i < unanalysed.length; i++) {
      const path = unanalysed[i]!;
      const file = files.get(path);
      if (file) {
        try {
          // Store the path without the top folder name, so the same library works if the folder is renamed.
          const rel = path.includes("/") ? path.split("/").slice(1).join("/") : path;
          added.push(await quickAnalyze(file, rel));
        } catch (e) {
          console.warn("Could not analyse", path, e);
        }
      }
      setAnalysing({ done: i + 1, total: unanalysed.length });
    }
    setAnalysing(null);
    onSaveSongs(added);
    onToast(`Analysed ${added.length} files. Check languages and moods in the Library for better sets.`);
  };

  if (playing && set) {
    return <Player set={set} playback={room.playback} files={files} onExit={() => setPlaying(false)} />;
  }

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <section className="panel" aria-labelledby="room-h">
        <div className="row spread">
          <h2 id="room-h">Tell it the room</h2>
          <div className="chips" role="group" aria-label="Play from">
            <button type="button" className="chip" aria-pressed={room.playback === "youtube"} onClick={() => setRoom({ ...room, playback: "youtube" })}>
              YouTube videos
            </button>
            <button type="button" className="chip" aria-pressed={room.playback === "local"} onClick={() => setRoom({ ...room, playback: "local" })}>
              My files
            </button>
          </div>
        </div>
        {room.playback === "local" && (
          <div className="notice">
            <div className="stack">
              <span>
                Pick the folder with your music or music videos. Files stay on this computer. With your own files, songs are time-stretched and
                blended on the beat.
              </span>
              <div className="row">
                <label className="btn">
                  Choose folder
                  <input type="file" hidden multiple {...{ webkitdirectory: "", directory: "" }} onChange={(e) => pickFolder(e.target.files)} />
                </label>
                <span className="muted small">
                  {files.size ? `${[...files.keys()].filter(isMediaFile).length} media files, ${playableSongs.length} in the library` : "No folder picked"}
                </span>
              </div>
              {unanalysed.length > 0 && (
                <div className="row">
                  <button type="button" className="btn" onClick={analyseNew} disabled={!!analysing}>
                    {analysing ? `Analysing ${analysing.done} of ${analysing.total}...` : `Quick-analyse ${unanalysed.length} new files`}
                  </button>
                  <span className="muted small">For key, hooks and vocals, run the Python analyser (see Set up).</span>
                </div>
              )}
            </div>
          </div>
        )}
        <RoomForm room={room} songs={playableSongs} onChange={setRoom} />
        <div className="row">
          <button type="button" className="btn primary big" onClick={build} disabled={room.languages.length === 0 || playableSongs.length === 0}>
            {set ? "Rebuild the set" : "Build the set"}
          </button>
          {cutsOnly && <span className="tag warn">iPhone and iPad: songs will cut instead of fading</span>}
        </div>
      </section>

      <section className="panel" aria-labelledby="set-h">
        <div className="row spread">
          <h2 id="set-h">The set</h2>
          {set && set.entries.length > 0 && (
            <span className="muted num">
              {set.entries.length} songs, {Math.round(set.seconds / 60)} min
            </span>
          )}
        </div>
        {!set ? (
          <p className="muted">Pick the languages, the moment and the crowd, then build. The set appears here with every transition explained.</p>
        ) : (
          <>
            {set.notes.map((n) => (
              <div key={n} className="notice">
                {n}
              </div>
            ))}
            {set.entries.length > 0 && (
              <div className="row">
                <button type="button" className="btn pink big" onClick={() => setPlaying(true)}>
                  Start the party
                </button>
                <SpotifyExport set={set} onToast={onToast} />
              </div>
            )}
            <SetList set={set} />
          </>
        )}
      </section>
    </div>
  );
}
