// Server-side Last.fm access: one HTTP request per call, no retries or caching.
// Queueing, retries and caching live in the browser (lib/lastfm-client.ts).

import type { ApiResult } from "@/lib/spotify";

const API = "https://ws.audioscrobbler.com/2.0/";
const MAX_TAGS = 10;
// Last.fm error codes: 29 = rate limit exceeded; 11/16 = service temporarily unavailable
const RATE_LIMITED = 29;
const TEMPORARY = new Set([11, 16]);

export type Tag = { name: string; count: number };
// Cached lookup result; correctedArtist is set when Last.fm's autocorrect changed the name
export type Lookup = { tags: Tag[]; correctedArtist?: string; notFound?: boolean };

type LastfmTag = { name: string; count: number | string };
type TopTagsResponse = {
  toptags?: { tag?: LastfmTag[] | LastfmTag; "@attr"?: { artist?: string } };
  error?: number;
  message?: string;
};

export async function getTopTags(params: Record<string, string>): Promise<ApiResult<Lookup>> {
  const query = new URLSearchParams({ ...params, autocorrect: "1", format: "json" });
  // URL shown on screen in error messages, so it must not carry the key
  const shownUrl = `${API}?${query}`;
  query.set("api_key", process.env.LASTFM_API_KEY ?? "");

  let res: Response;
  try {
    res = await fetch(`${API}?${query}`, { cache: "no-store" });
  } catch (err) {
    return { ok: false, url: shownUrl, status: null, raw: `falha de rede: ${String(err)}` };
  }
  const text = await res.text();
  let body: TopTagsResponse;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, url: shownUrl, status: res.status, raw: text };
  }

  // Last.fm error 6 = artist/track not found; not a failure, just no tags
  if (body.error === 6) return { ok: true, data: { tags: [], notFound: true } };
  if (body.error === RATE_LIMITED) return { ok: false, url: shownUrl, status: 429, raw: text };
  if (body.error && TEMPORARY.has(body.error)) return { ok: false, url: shownUrl, status: 503, raw: text };
  if (!res.ok || body.error) return { ok: false, url: shownUrl, status: res.status, raw: text };

  const rawTags = body.toptags?.tag;
  const list = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
  const corrected = body.toptags?.["@attr"]?.artist;
  return {
    ok: true,
    data: {
      correctedArtist: corrected && corrected !== params.artist ? corrected : undefined,
      tags: list
        .slice(0, MAX_TAGS)
        .map((t) => ({ name: t.name.toLowerCase().trim(), count: Number(t.count) })),
    },
  };
}
