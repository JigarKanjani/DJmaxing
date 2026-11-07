import { useMemo } from "react";
import { hasMedia, isSlow } from "../lib/brain/selection";
import { LANGUAGES, MOODS, type Crowd, type Language, type Moment, type Mood, type Room, type Song } from "../lib/types";

const MOMENTS: { id: Moment; label: string; hint: string }[] = [
  { id: "warmup", label: "Warming up", hint: "People arriving, energy builds slowly" },
  { id: "peak", label: "Peak time", hint: "Full dance floor, waves of big songs" },
  { id: "bangers", label: "Only bangers", hint: "Highest energy, no slow songs" },
  { id: "winddown", label: "Winding down", hint: "Late night, singalongs, easing off" },
];
const CROWDS: { id: Crowd; label: string; hint: string }[] = [
  { id: "small", label: "4 to 8", hint: "Music you can talk over" },
  { id: "medium", label: "10 to 30", hint: "A proper party" },
  { id: "large", label: "30+", hint: "A wedding dance floor" },
];
const LANG_LABEL: Record<Language, string> = {
  hindi: "Hindi", punjabi: "Punjabi", english: "English", gujarati: "Gujarati", tamil: "Tamil", telugu: "Telugu",
  haryanvi: "Haryanvi", bhojpuri: "Bhojpuri", marathi: "Marathi", bengali: "Bengali", other: "Other",
};
export const MOOD_LABEL: Record<Mood, string> = {
  dance: "Dance", party: "Party", wedding: "Wedding", bhangra: "Bhangra", romantic: "Romantic", sad: "Sad", sufi: "Sufi",
  retro: "Retro", gym: "Gym", hiphop: "Hip-hop", garba: "Garba", pop: "Pop", edm: "EDM", devotional: "Devotional",
};
export { LANG_LABEL };

export interface RoomFormProps {
  room: Room;
  songs: Song[];
  onChange: (room: Room) => void;
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function RoomForm({ room, songs, onChange }: RoomFormProps) {
  const playable = useMemo(() => songs.filter((s) => hasMedia(s, room.playback)), [songs, room.playback]);
  const langCounts = useMemo(() => {
    const m = new Map<Language, number>();
    for (const s of playable) m.set(s.language, (m.get(s.language) ?? 0) + 1);
    return m;
  }, [playable]);
  const moodCounts = useMemo(() => {
    const m = new Map<Mood, number>();
    for (const s of playable) if (room.languages.length === 0 || room.languages.includes(s.language)) for (const mood of s.moods) m.set(mood, (m.get(mood) ?? 0) + 1);
    return m;
  }, [playable, room.languages]);
  const slowCount = playable.filter(isSlow).length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="field">
        <span className="label">Languages the room wants</span>
        <div className="chips">
          {LANGUAGES.filter((l) => (langCounts.get(l) ?? 0) > 0).map((l) => (
            <button key={l} type="button" className="chip" aria-pressed={room.languages.includes(l)} onClick={() => onChange({ ...room, languages: toggle(room.languages, l) })}>
              {LANG_LABEL[l]}
              <span className="count">{langCounts.get(l)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">Moods (leave empty for any upbeat song)</span>
        <div className="chips">
          {MOODS.filter((m) => (moodCounts.get(m) ?? 0) > 0).map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={room.moods.includes(m)} onClick={() => onChange({ ...room, moods: toggle(room.moods, m) })}>
              {MOOD_LABEL[m]}
              <span className="count">{moodCounts.get(m)}</span>
            </button>
          ))}
        </div>
        {slowCount > 0 && <span className="muted small">Slow songs only play when you pick a slow mood or Winding down.</span>}
      </div>
      <div className="field">
        <span className="label">Moment of the night</span>
        <div className="choice">
          {MOMENTS.map((m) => (
            <button key={m.id} type="button" aria-pressed={room.moment === m.id} onClick={() => onChange({ ...room, moment: m.id })}>
              <b>{m.label}</b>
              <span>{m.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <span className="label">People</span>
          <div className="choice">
            {CROWDS.map((c) => (
              <button key={c.id} type="button" aria-pressed={room.crowd === c.id} onClick={() => onChange({ ...room, crowd: c.id })}>
                <b>{c.label}</b>
                <span>{c.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="minutes">
            Set length: <span className="num">{room.minutes}</span> minutes
          </label>
          <input id="minutes" type="range" min={10} max={240} step={5} value={room.minutes} onChange={(e) => onChange({ ...room, minutes: Number(e.target.value) })} />
          <span className="muted small">Songs play from their best part for about a minute each, so an hour is roughly 45 to 60 songs.</span>
        </div>
      </div>
    </div>
  );
}
