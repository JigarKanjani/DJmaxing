// Saves a built set as a Spotify playlist, so it can be mixed in DJ software that streams
// Spotify (djay Pro, rekordbox, Serato). The app itself never plays Spotify audio: Spotify's
// developer terms do not allow apps to mix, overlap or sync its audio with video.
//
// Follows the February 2026 Web API rules for Development Mode apps:
// authorization code with PKCE (no client secret), POST /me/playlists, POST /playlists/{id}/items,
// and search limit at most 10.

import type { Song } from "../types";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = "playlist-modify-private playlist-modify-public";
const TOKEN_KEY = "djmaxing.spotify.token";
const VERIFIER_KEY = "djmaxing.spotify.verifier";
const STATE_KEY = "djmaxing.spotify.state";
const PENDING_KEY = "djmaxing.spotify.pending";

export interface SpotifyToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

export interface PendingExport {
  name: string;
  songIds: string[];
}

export function clientId(): string {
  return (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim() ?? "";
}

export function redirectUri(): string {
  // Spotify allows https, or http on a loopback IP (127.0.0.1), but not "localhost".
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function readToken(): SpotifyToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as SpotifyToken) : null;
  } catch {
    return null;
  }
}

function saveToken(t: { access_token: string; refresh_token?: string; expires_in: number }, previousRefresh?: string) {
  const token: SpotifyToken = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? previousRefresh,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    // Without storage the user signs in each time.
  }
  return token;
}

export function isSignedIn(): boolean {
  return readToken() !== null;
}

export function signOut(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to remove.
  }
}

/** Sends the user to Spotify to approve playlist access. Remembers what to export afterwards. */
export async function beginSignIn(pending?: PendingExport): Promise<void> {
  const id = clientId();
  if (!id) throw new Error("Spotify is not set up: add VITE_SPOTIFY_CLIENT_ID (see README).");
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  if (pending) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: await pkceChallenge(verifier),
    redirect_uri: redirectUri(),
    state,
  });
  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

/**
 * Finishes sign-in when Spotify redirects back with ?code=...
 * Returns the export the user asked for before signing in, if any.
 */
export async function completeSignInFromUrl(): Promise<{ handled: boolean; pending: PendingExport | null; error?: string }> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (!code && !error) return { handled: false, pending: null };
  const clean = () => window.history.replaceState(null, "", url.pathname + url.hash);
  if (error) {
    clean();
    return { handled: true, pending: null, error: error === "access_denied" ? "Spotify sign-in was cancelled." : `Spotify sign-in failed: ${error}` };
  }
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  clean();
  if (!verifier || state !== expectedState) return { handled: true, pending: null, error: "Spotify sign-in could not be verified. Try again." };
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: code!, redirect_uri: redirectUri(), client_id: clientId(), code_verifier: verifier }),
  });
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!res.ok) return { handled: true, pending: null, error: `Spotify sign-in failed (${res.status}).` };
  saveToken(await res.json());
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  return { handled: true, pending: raw ? (JSON.parse(raw) as PendingExport) : null };
}

async function accessToken(): Promise<string> {
  const t = readToken();
  if (!t) throw new Error("Not signed in to Spotify.");
  if (Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) throw new Error("Spotify session expired. Sign in again.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId() }),
  });
  if (!res.ok) {
    signOut();
    throw new Error("Spotify session expired. Sign in again.");
  }
  return saveToken(await res.json(), t.refresh_token).access_token;
}

async function api<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 429 && attempt < 4) {
    const wait = Number(res.headers.get("Retry-After") ?? "2");
    await new Promise((r) => setTimeout(r, Math.min(30, wait) * 1000));
    return api<T>(path, init, attempt + 1);
  }
  if (res.status === 403) throw new Error("Spotify refused the request (403). In Development Mode, the app owner needs Premium and your account must be added under Users and Access in the Spotify dashboard.");
  if (!res.ok) throw new Error(`Spotify error ${res.status} on ${path}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

interface SearchTrack {
  uri: string;
  name: string;
  artists: { name: string }[];
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft|official video|lyrical|full song)\b.*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Picks the result whose title and first artist best match the song. Exported for tests. */
export function bestMatch(song: Pick<Song, "title" | "artist">, tracks: SearchTrack[]): SearchTrack | null {
  const wantTitle = normalize(song.title);
  const wantArtist = normalize(song.artist.split(/,|&/)[0] ?? song.artist);
  let best: { t: SearchTrack; score: number } | null = null;
  for (const t of tracks) {
    const title = normalize(t.name);
    const artists = t.artists.map((a) => normalize(a.name));
    let score = 0;
    if (title === wantTitle) score += 3;
    else if (title.startsWith(wantTitle) || wantTitle.startsWith(title)) score += 2;
    else if (title.includes(wantTitle) || wantTitle.includes(title)) score += 1;
    if (artists.some((a) => a === wantArtist || a.includes(wantArtist) || wantArtist.includes(a))) score += 2;
    if (!best || score > best.score) best = { t, score };
  }
  return best && best.score >= 3 ? best.t : null;
}

async function findTrack(song: Song): Promise<string | null> {
  if (song.media.spotifyUri) return song.media.spotifyUri;
  const artist = song.artist.split(/,|&/)[0]?.trim() ?? song.artist;
  const queries = [`track:${song.title} artist:${artist}`, `${song.title} ${artist}`];
  for (const q of queries) {
    const data = await api<{ tracks?: { items: SearchTrack[] } }>(`/search?${new URLSearchParams({ q, type: "track", limit: "10" })}`);
    const hit = bestMatch(song, data.tracks?.items ?? []);
    if (hit) return hit.uri;
  }
  return null;
}

export interface ExportResult {
  url: string | null;
  added: number;
  missing: Song[];
}

export async function exportPlaylist(name: string, songs: Song[], onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  const uris: string[] = [];
  const missing: Song[] = [];
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i]!;
    const uri = await findTrack(s);
    if (uri) uris.push(uri);
    else missing.push(s);
    onProgress?.(i + 1, songs.length);
  }
  const playlist = await api<{ id: string; external_urls?: { spotify?: string } }>("/me/playlists", {
    method: "POST",
    body: JSON.stringify({ name, public: false, description: "Built by DJmaxing. Order follows the energy plan; mix it in djay, rekordbox or Serato." }),
  });
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${playlist.id}/items`, { method: "POST", body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
  }
  return { url: playlist.external_urls?.spotify ?? null, added: uris.length, missing };
}
