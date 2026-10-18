// Artist country from MusicBrainz, used only to decide the bare "funk" tag (lib/classify.ts).
// MusicBrainz asks for at most 1 request per second and a User-Agent that identifies the app:
// https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting

import type { ApiResult } from "@/lib/spotify";

const API = "https://musicbrainz.org/ws/2/artist";
export const MB_USER_AGENT = "PlaylistSplitter/0.1 ( https://github.com/leomitas/testclaude )";
export const MB_INTERVAL_MS = 1000;
export const MIN_SCORE = 90;

export type MbArtist = {
  name: string;
  score: number;
  country?: string | null;
  aliases?: { name: string }[] | null;
};

// Case-, accent- and punctuation-insensitive, keeping letters of every script (a name written
// in Japanese must not normalize to "" and match any other such name)
export function matchName(s: string) {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// Country (ISO code) of the best result, only when it's a confident, exact match: score >= 90
// and the name, or one of its aliases, equal to the query once normalized. Otherwise null.
export function pickCountry(artists: MbArtist[], query: string): string | null {
  const q = matchName(query);
  if (!q) return null;
  const best = [...artists].sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < MIN_SCORE) return null;
  const names = [best.name, ...(best.aliases ?? []).map((a) => a.name)];
  if (!names.some((n) => matchName(n) === q)) return null;
  return best.country ? best.country.toUpperCase() : null;
}

// Lucene query: the name between quotes, with quotes and backslashes escaped
export const searchUrl = (artist: string) =>
  `${API}?query=${encodeURIComponent(`artist:"${artist.replace(/[\\"]/g, "\\$&")}"`)}&fmt=json&limit=3`;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// One request, no retries (the browser queue retries 503/429/5xx with backoff)
export async function lookupCountry(artist: string, fetchFn: Fetch = fetch): Promise<ApiResult<{ country: string | null }>> {
  const url = searchUrl(artist);
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { "User-Agent": MB_USER_AGENT, Accept: "application/json" }, cache: "no-store" });
  } catch (err) {
    return { ok: false, url, status: null, raw: `falha de rede: ${String(err)}` };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, url, status: res.status, raw: text.slice(0, 300) };
  try {
    const body = JSON.parse(text) as { artists?: MbArtist[] };
    return { ok: true, data: { country: pickCountry(body.artists ?? [], artist) } };
  } catch {
    return { ok: false, url, status: res.status, raw: text.slice(0, 300) };
  }
}

// Spaces calls at least intervalMs apart, across every caller (the server is shared by tabs)
export function createThrottle(intervalMs: number, now: () => number = Date.now, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
  let next = 0;
  return async () => {
    const t = now();
    const start = Math.max(t, next);
    next = start + intervalMs;
    if (start > t) await sleep(start - t);
  };
}
