// MusicBrainz country lookups for the browser queue. Same session check as /api/lastfm; calls
// are spaced 1 s apart here too, since several tabs can share the server.

import { auth } from "@/auth";
import { createThrottle, lookupCountry, MB_INTERVAL_MS } from "@/lib/musicbrainz";

const MAX_LEN = 300;
const throttle = createThrottle(MB_INTERVAL_MS);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken || session.error) {
    return Response.json(
      { ok: false, url: "/api/musicbrainz", status: 401, code: "session-expired", raw: "Session expired or missing." },
      { status: 401 },
    );
  }

  const artist = Array.from((new URL(req.url).searchParams.get("artist") ?? "").trim()).slice(0, MAX_LEN).join("");
  if (!artist) return Response.json({ ok: false, url: "/api/musicbrainz", status: 400, code: "empty-artist", raw: "Empty artist." }, { status: 400 });

  await throttle();
  return Response.json(await lookupCountry(artist));
}
