// Harmonic mixing on the Camelot wheel.
// Numbers 1-12 go round the circle of fifths; A is minor, B is major.
// Neighbours on the wheel share six of seven scale notes, so they mix without clashing.

export interface CamelotKey {
  num: number;
  letter: "A" | "B";
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_TO_SHARP: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

// Camelot number for each pitch class (index = semitone above C).
const MAJOR_TO_NUM = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_TO_NUM = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

export function parseCamelot(value: string | null | undefined): CamelotKey | null {
  if (!value) return null;
  const m = /^\s*(1[0-2]|[1-9])\s*([AaBb])\s*$/.exec(value);
  if (!m || !m[1] || !m[2]) return null;
  return { num: Number(m[1]), letter: m[2].toUpperCase() as "A" | "B" };
}

export function formatCamelot(key: CamelotKey): string {
  return `${key.num}${key.letter}`;
}

/** Converts a key name such as "A minor", "Am", "F# major" or "Bb" into Camelot notation. */
export function keyNameToCamelot(name: string): string | null {
  const m = /^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(m|min|minor|maj|major|M)?\s*$/.exec(name.trim());
  if (!m || !m[1]) return null;
  let note = m[1].toUpperCase() + (m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : (m[2] ?? ""));
  if (note.endsWith("b")) note = FLAT_TO_SHARP[note] ?? (note === "Cb" ? "B" : note === "Fb" ? "E" : note);
  if (note === "E#") note = "F";
  if (note === "B#") note = "C";
  const pc = NOTE_NAMES.indexOf(note as (typeof NOTE_NAMES)[number]);
  if (pc < 0) return null;
  const quality = m[3];
  const minor = quality === "m" || quality === "min" || quality === "minor";
  const num = (minor ? MINOR_TO_NUM : MAJOR_TO_NUM)[pc];
  return num ? `${num}${minor ? "A" : "B"}` : null;
}

/** Steps between two Camelot numbers going round the wheel, from -5 to +6. */
function wheelStep(from: number, to: number): number {
  let d = (to - from) % 12;
  if (d < 0) d += 12;
  return d > 6 ? d - 12 : d;
}

/**
 * How well the incoming key follows the outgoing key, from 0 (clash) to 1 (same key).
 * Unknown keys score a neutral 0.5 so they are neither favoured nor punished.
 */
export function keyCompatibility(outgoing: string | null | undefined, incoming: string | null | undefined): number {
  const a = parseCamelot(outgoing);
  const b = parseCamelot(incoming);
  if (!a || !b) return 0.5;
  const step = wheelStep(a.num, b.num);
  const sameLetter = a.letter === b.letter;
  if (step === 0 && sameLetter) return 1; // same key
  if (step === 0) return 0.85; // relative major/minor
  if (sameLetter && Math.abs(step) === 1) return 0.9; // one step round the wheel
  if (sameLetter && step === 2) return 0.6; // two steps up: an "energy boost"
  if (!sameLetter && Math.abs(step) === 1) return 0.55; // diagonal move
  if (sameLetter && step === -5) return 0.45; // +7 numbers = one semitone up, a classic lift
  return 0.15;
}

/** All keys that mix well after the given key, best first. Used by the curator for hints. */
export function compatibleKeys(value: string): string[] {
  const k = parseCamelot(value);
  if (!k) return [];
  const other = k.letter === "A" ? "B" : "A";
  const wrap = (n: number) => ((n - 1 + 12) % 12) + 1;
  return [`${k.num}${k.letter}`, `${wrap(k.num - 1)}${k.letter}`, `${wrap(k.num + 1)}${k.letter}`, `${k.num}${other}`, `${wrap(k.num + 2)}${k.letter}`];
}
