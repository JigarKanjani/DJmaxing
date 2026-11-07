// Vercel serverless function: GET /api/youtube-search?q=...
// Keeps the YouTube Data API key on the server. Set YOUTUBE_API_KEY in the Vercel project settings.
// Only embeddable music videos are returned, so everything found can play in the app.

interface YtItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string } } };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });
}

export async function GET(request: Request): Promise<Response> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return json({ error: "not_configured", message: "YOUTUBE_API_KEY is not set on the server." }, 501);

  // Only answer requests from this site, so the key's daily quota cannot be used by others.
  const url = new URL(request.url);
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) return json({ error: "forbidden" }, 403);
    } catch {
      return json({ error: "forbidden" }, 403);
    }
  }

  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (!q) return json({ error: "missing_query" }, 400);

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoCategoryId: "10",
    maxResults: "10",
    q,
    key,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) return json({ error: "upstream", status: res.status }, 502);
  const data = (await res.json()) as { items?: YtItem[] };
  const results = (data.items ?? [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      id: i.id!.videoId!,
      title: i.snippet?.title ?? "",
      channel: i.snippet?.channelTitle ?? "",
      published: i.snippet?.publishedAt ?? null,
      thumbnail: i.snippet?.thumbnails?.medium?.url ?? null,
    }));
  // Each search costs 100 quota units of the free 10,000 per day, so cache answers for a day.
  return json({ results }, 200, { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" });
}
