// Browser-side Last.fm lookups: queue (3 at a time, retries with backoff) + persistent cache.

import { idbGet, idbSet } from "@/lib/idb";
import type { Lookup } from "@/lib/lastfm";
import { createRequestQueue } from "@/lib/request-queue";
import type { ApiResult } from "@/lib/spotify";

export const lastfm = createRequestQueue({
  concurrency: 3,
  intervalMs: 200,
  // rate limit, Last.fm hiccups and network drops are all worth retrying
  shouldRetry: (e) => e.status === 429 || e.status === null || e.status >= 500,
});

// Same lookup requested twice at once (e.g. an artist shared by many tracks) hits the network once
const inFlight = new Map<string, Promise<ApiResult<Lookup>>>();

// Awaited before the network call: waits while paused, resolves true to stop
type Checkpoint = () => Promise<boolean>;

async function fetchTags(params: Record<string, string>): Promise<ApiResult<Lookup>> {
  const res = await fetch(`/api/lastfm?${new URLSearchParams(params)}`, { cache: "no-store" });
  return (await res.json()) as ApiResult<Lookup>;
}

async function lookup(key: string, params: Record<string, string>, checkpoint?: Checkpoint): Promise<ApiResult<Lookup>> {
  const hit = await idbGet<Lookup>("cache", key);
  if (hit) return { ok: true, data: hit };

  if (!inFlight.has(key) && (await checkpoint?.())) {
    return { ok: false, url: "/api/lastfm", status: null, raw: "cancelado" };
  }
  let p = inFlight.get(key);
  if (!p) {
    p = lastfm.call(() => fetchTags(params), "/api/lastfm").then(async (r) => {
      if (r.ok) await idbSet("cache", key, r.data);
      inFlight.delete(key);
      return r;
    });
    inFlight.set(key, p);
  }
  return p;
}

export const getArtistTags = (artist: string, checkpoint?: Checkpoint) =>
  lookup(`artist:${artist.toLowerCase()}`, { artist }, checkpoint);

export const getTrackTags = (artist: string, track: string, checkpoint?: Checkpoint) =>
  lookup(`track:${artist}|${track}`.toLowerCase(), { artist, track }, checkpoint);
