// Netlify version of api/youtube-search.ts, served at the same path: /api/youtube-search
// Set YOUTUBE_API_KEY under Site configuration > Environment variables (not prefixed with VITE_).
import { GET } from "../../api/youtube-search";

export default async (request: Request): Promise<Response> => GET(request);

export const config = { path: "/api/youtube-search" };
