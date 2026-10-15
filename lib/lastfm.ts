import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApiError } from "@/lib/spotify";

const API = "https://ws.audioscrobbler.com/2.0/";
const MAX_TAGS = 10;
const CONCURRENCY = 4;
const CACHE_DIR = path.join(process.cwd(), ".cache");

export type Tag = { name: string; count: number };
// Cached lookup result; correctedArtist is set when Last.fm's autocorrect changed the name
export type Lookup = { tags: Tag[]; correctedArtist?: string; notFound?: boolean };

export type TrackLookup = {
  artist: Lookup | null;
  track: Lookup | null;
};

type LastfmTag = { name: string; count: number | string };
type TopTagsResponse = {
  toptags?: { tag?: LastfmTag[] | LastfmTag; "@attr"?: { artist?: string } };
  error?: number;
  message?: string;
};

class FileCache {
  private map: Map<string, Lookup> | null = null;
  private dirty = false;
  private file: string;
  constructor(file: string) {
    this.file = file;
  }

  async get(key: string) {
    if (!this.map) {
      try {
        this.map = new Map(Object.entries(JSON.parse(await readFile(this.file, "utf8"))));
      } catch {
        this.map = new Map();
      }
    }
    return this.map.get(key);
  }

  set(key: string, value: Lookup) {
    this.map?.set(key, value);
    this.dirty = true;
  }

  async save() {
    if (!this.map || !this.dirty) return;
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(this.file, JSON.stringify(Object.fromEntries(this.map), null, 2));
    this.dirty = false;
  }
}

// Raw (unfiltered) tags; file names differ from earlier filtered caches on purpose
const artistCache = new FileCache(path.join(CACHE_DIR, "lastfm-artist-raw.json"));
const trackCache = new FileCache(path.join(CACHE_DIR, "lastfm-track-raw.json"));

async function getTopTags(params: Record<string, string>): Promise<Lookup | ApiError> {
  const query = new URLSearchParams({ ...params, autocorrect: "1", format: "json" });
  // URL shown on screen in error messages, so it must not carry the key
  const shownUrl = `${API}?${query}`;
  query.set("api_key", process.env.LASTFM_API_KEY ?? "");

  let res: Response;
  try {
    res = await fetch(`${API}?${query}`, { cache: "no-store" });
  } catch (err) {
    return { url: shownUrl, status: null, raw: `falha de rede: ${String(err)}` };
  }
  const text = await res.text();
  let body: TopTagsResponse;
  try {
    body = JSON.parse(text);
  } catch {
    return { url: shownUrl, status: res.status, raw: text };
  }

  // Last.fm error 6 = artist/track not found; not a failure, just no tags
  if (body.error === 6) return { tags: [], notFound: true };
  if (!res.ok || body.error) return { url: shownUrl, status: res.status, raw: text };

  const rawTags = body.toptags?.tag;
  const list = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
  const corrected = body.toptags?.["@attr"]?.artist;
  return {
    correctedArtist: corrected && corrected !== params.artist ? corrected : undefined,
    tags: list
      .slice(0, MAX_TAGS)
      .map((t) => ({ name: t.name.toLowerCase().trim(), count: Number(t.count) })),
  };
}

async function cached(
  cache: FileCache,
  key: string,
  load: () => Promise<Lookup | ApiError>,
): Promise<Lookup | ApiError> {
  const hit = await cache.get(key);
  if (hit) return hit;
  const r = await load();
  if ("tags" in r) cache.set(key, r);
  return r;
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

// Fetches both artist and track tags for every track (artist lookups are shared via cache)
export async function getTagsForTracks(
  tracks: { name: string; artist: string }[],
): Promise<{ results: TrackLookup[]; errors: ApiError[] }> {
  const errors: ApiError[] = [];
  const settle = (r: Lookup | ApiError) => {
    if ("tags" in r) return r;
    errors.push(r);
    return null;
  };

  // Resolve each artist once up front so concurrent tracks don't duplicate requests
  const artists = [...new Set(tracks.map((t) => t.artist))];
  const artistResults = new Map<string, Lookup | null>();
  await mapPool(artists, CONCURRENCY, async (artist) => {
    const r = await cached(artistCache, artist.toLowerCase(), () =>
      getTopTags({ method: "artist.getTopTags", artist }),
    );
    artistResults.set(artist, settle(r));
  });

  const results = await mapPool(tracks, CONCURRENCY, async ({ name, artist }) => {
    const r = await cached(trackCache, `${artist}|${name}`.toLowerCase(), () =>
      getTopTags({ method: "track.getTopTags", artist, track: name }),
    );
    return { artist: artistResults.get(artist) ?? null, track: settle(r) };
  });

  await Promise.all([trackCache.save(), artistCache.save()]);
  return { results, errors };
}
