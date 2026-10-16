// Last.fm tag lookups for the browser queue. A Route Handler instead of a server action
// because server actions are dispatched one at a time, which would cap concurrency at 1.

import { auth } from "@/auth";
import { getTopTags } from "@/lib/lastfm";

const MAX_LEN = 300;

// Trim and cut (by code point, so emojis aren't split) instead of rejecting long input
const clean = (s: string | null) => Array.from((s ?? "").trim()).slice(0, MAX_LEN).join("");

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken || session.error) {
    return Response.json(
      { ok: false, url: "/api/lastfm", status: 401, raw: "Sessão expirada ou ausente. Entre novamente." },
      { status: 401 },
    );
  }

  const params = new URL(req.url).searchParams;
  const artist = clean(params.get("artist"));
  const track = clean(params.get("track"));
  // Last.fm can't look anything up without an artist (Spotify returns "" for unavailable tracks)
  if (!artist) {
    console.warn("[lastfm] rejected: empty artist", JSON.stringify({ artist: params.get("artist"), track: params.get("track") }));
    return Response.json({ ok: false, url: "/api/lastfm", status: 400, raw: "Artista vazio." }, { status: 400 });
  }

  const result = track
    ? await getTopTags({ method: "track.getTopTags", artist, track })
    : await getTopTags({ method: "artist.getTopTags", artist });
  return Response.json(result);
}
