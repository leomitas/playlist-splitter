// Last.fm tag lookups for the browser queue. A Route Handler instead of a server action
// because server actions are dispatched one at a time, which would cap concurrency at 1.

import { auth } from "@/auth";
import { getTopTags } from "@/lib/lastfm";

const MAX_LEN = 300;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken || session.error) {
    return Response.json(
      { ok: false, url: "/api/lastfm", status: 401, raw: "Sessão expirada ou ausente. Entre novamente." },
      { status: 401 },
    );
  }

  const params = new URL(req.url).searchParams;
  const artist = params.get("artist")?.trim() ?? "";
  const track = params.get("track")?.trim() ?? "";
  if (!artist || artist.length > MAX_LEN || track.length > MAX_LEN) {
    return Response.json({ ok: false, url: "/api/lastfm", status: 400, raw: "Parâmetros inválidos." }, { status: 400 });
  }

  const result = track
    ? await getTopTags({ method: "track.getTopTags", artist, track })
    : await getTopTags({ method: "artist.getTopTags", artist });
  return Response.json(result);
}
