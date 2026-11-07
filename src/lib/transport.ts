// A simple play/pause/seek handle over either a YouTube player or a local media element,
// used by the curator's tap tool.

import { loadYouTubeApi } from "./youtube/loadApi";

export interface Transport {
  play(): void;
  pause(): void;
  seek(t: number): void;
  time(): number;
  duration(): number;
  isPlaying(): boolean;
  destroy(): void;
}

export async function youtubeTransport(host: HTMLElement, videoId: string): Promise<Transport> {
  const YTApi = await loadYouTubeApi();
  const mount = document.createElement("div");
  host.replaceChildren(mount);
  const player = await new Promise<YT.Player>((resolve, reject) => {
    const p = new YTApi.Player(mount, {
      width: "100%",
      height: "100%",
      videoId,
      playerVars: { controls: 1, rel: 0, playsinline: 1, iv_load_policy: 3, origin: window.location.origin },
      events: {
        onReady: () => resolve(p),
        onError: (e) => reject(new Error(`YouTube could not play this video (error ${e.data}). It may block embedding; try another upload.`)),
      },
    });
  });
  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (t) => player.seekTo(Math.max(0, t), true),
    time: () => player.getCurrentTime?.() ?? 0,
    duration: () => player.getDuration?.() ?? 0,
    isPlaying: () => player.getPlayerState?.() === YT.PlayerState.PLAYING,
    destroy: () => {
      try {
        player.destroy();
      } catch {
        // Already gone.
      }
    },
  };
}

export function mediaTransport(host: HTMLElement, file: File): Transport {
  const url = URL.createObjectURL(file);
  const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
  el.src = url;
  el.controls = true;
  el.preload = "auto";
  el.style.width = "100%";
  el.style.height = "100%";
  host.replaceChildren(el);
  return {
    play: () => void el.play(),
    pause: () => el.pause(),
    seek: (t) => {
      el.currentTime = Math.max(0, t);
    },
    time: () => el.currentTime,
    duration: () => (Number.isFinite(el.duration) ? el.duration : 0),
    isPlaying: () => !el.paused,
    destroy: () => {
      el.pause();
      el.remove();
      URL.revokeObjectURL(url);
    },
  };
}
