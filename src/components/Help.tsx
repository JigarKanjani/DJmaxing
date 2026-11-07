import { clientId, redirectUri } from "../lib/spotify/spotify";

export function Help() {
  const spotify = clientId();
  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <section className="panel">
        <h2>How a party works</h2>
        <ol className="stack" style={{ paddingLeft: 18, margin: 0 }}>
          <li>On Party, pick the languages, the moment and the crowd, then build the set.</li>
          <li>Each row shows the song's energy against the plan for that slot, and how it hands over: a beat-matched blend, a cut on the downbeat, or a short fade.</li>
          <li>Press Start, connect the speakers, press Play. Keep this tab in front; both video decks stay visible.</li>
          <li>Use Next song, Hold this song, and Pause any time. The keyboard works too: Space, N and H.</li>
        </ol>
        <h3>Making the mixes better</h3>
        <p className="muted">
          Songs blend on the beat once they have a tempo, a downbeat and a hook. Open a song in Library, tap along with T, press D on the first beat
          of a bar, then I where the hook starts and O where it should hand over. Save as checked. Export the library to back it up.
        </p>
        <h3>Ads</h3>
        <p className="muted">
          DJmaxing plays YouTube's own player and does not block or skip ads, which YouTube's rules require. Signing the party computer into a YouTube
          Premium account removes ads. Playing your own files (My files) has no ads at all.
        </p>
      </section>
      <section className="panel">
        <h2>Connections</h2>
        <div className="stack">
          <h3>Spotify {spotify ? <span className="tag blend">connected</span> : <span className="tag warn">not set up</span>}</h3>
          <p className="muted">
            Spotify's developer rules do not allow apps to mix or overlap its songs or play them with video, so DJmaxing uses Spotify for one job:
            saving the finished set as a private playlist. Open that playlist in djay Pro, rekordbox or Serato with your Premium account to mix it there.
          </p>
          {!spotify && (
            <p className="muted small">
              To turn it on, create an app at developer.spotify.com/dashboard, add the redirect URI <span className="mono">{redirectUri()}</span>, and set
              <span className="mono"> VITE_SPOTIFY_CLIENT_ID</span>. Full steps are in the README.
            </p>
          )}
          <h3>YouTube search</h3>
          <p className="muted">
            Optional. Lets the Library search YouTube instead of pasting links. Needs a free YouTube Data API key stored on the server as
            <span className="mono"> YOUTUBE_API_KEY</span> (Vercel project settings). The key never reaches the browser.
          </p>
          <h3>Your own files</h3>
          <p className="muted">
            Switch Party to My files and pick a folder. For full analysis (key, downbeats, hooks, vocals), run the Python analyser in the
            <span className="mono"> analyzer</span> folder and import its JSON in Library.
          </p>
        </div>
      </section>
    </div>
  );
}
