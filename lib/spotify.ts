// Server-side Spotify access: one HTTP request per call, no retries.
// Queueing, 429 retries and caching live in the browser (lib/spotify-client.ts).

const API = "https://api.spotify.com/v1";
export const PAGE_SIZE = 50;

export type SpotifyImage = { url: string };
export type Me = {
  id: string;
  display_name: string | null;
  email?: string;
  images?: SpotifyImage[];
};
export type Playlist = {
  id: string;
  name: string;
  images: SpotifyImage[] | null;
  owner: { id: string; display_name: string | null };
  collaborative: boolean;
  description?: string | null;
  snapshot_id: string;
  // track count; Feb 2026 API renamed "tracks" to "items", accept both
  tracks?: { total: number } | null;
  items?: { total: number } | null;
};
type Track = {
  id: string | null;
  uri?: string;
  name: string;
  type?: string;
  is_local?: boolean;
  artists: { id: string | null; name: string }[];
};
// Feb 2026 API renamed playlist "track" to "item"; accept both
type PlaylistItem = { item?: Track | null; track?: Track | null; added_at?: string };
type Page<T> = { items: T[]; total: number; next: string | null };

export type ApiError = {
  method?: string;
  url: string;
  status: number | null;
  raw: string;
  // seconds, from the Retry-After header of a 429
  retryAfter?: number;
  // set when the call was refused because Spotify blocked the app until this time (ms)
  blockedUntil?: number;
  // set on errors the app produces itself: the UI shows a translated message (with `vars`)
  // and `raw` stays a technical English line
  code?: AppErrorCode;
  vars?: Record<string, string>;
};
export type AppErrorCode =
  | "session-expired"
  | "invalid-playlist-id"
  | "empty-name"
  | "invalid-batch"
  | "empty-artist"
  | "config-missing"
  | "spotify-blocked"
  | "liked-not-cached";
export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiError);

// firstAddedAt: added_at of the page's first item (liked songs use it as a version marker)
export type PageResult<T> = { items: T[]; total: number; nextOffset: number | null; firstAddedAt?: string };
// artistId: first artist's Spotify id (missing for local files and in caches older than the field)
export type PlaylistTrack = { key: string; uri: string | null; name: string; artists: string[]; artistId?: string };

async function spotifyRequest<T>(
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const url = `${API}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, method, url, status: null, raw: `falha de rede: ${String(err)}` };
  }
  if (!res.ok) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    return {
      ok: false,
      method,
      url,
      status: res.status,
      raw: await res.text(),
      ...(Number.isFinite(retryAfter) && retryAfter > 0 && { retryAfter }),
    };
  }
  return { ok: true, data: (await res.json()) as T };
}

export const spotifyGet = <T>(path: string, token: string) => spotifyRequest<T>("GET", path, token);

export const spotifyPost = <T>(path: string, token: string, body: unknown) =>
  spotifyRequest<T>("POST", path, token, body);

async function getPage<T, R>(
  path: string,
  offset: number,
  token: string,
  map: (items: T[]) => R[],
  limit = PAGE_SIZE,
): Promise<ApiResult<PageResult<R>>> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await spotifyGet<Page<T>>(`${path}${sep}limit=${limit}&offset=${offset}`, token);
  if (!r.ok) return r;
  const next = offset + r.data.items.length;
  const firstAddedAt = (r.data.items[0] as { added_at?: string } | null | undefined)?.added_at;
  return {
    ok: true,
    data: {
      items: map(r.data.items),
      total: r.data.total,
      nextOffset: r.data.next && r.data.items.length > 0 ? next : null,
      ...(firstAddedAt && { firstAddedAt }),
    },
  };
}

export const getPlaylistsPage = (offset: number, token: string) =>
  getPage<Playlist | null, Playlist>("/me/playlists", offset, token, (items) =>
    items.filter((p): p is Playlist => !!p),
  );

// Shared by playlists and liked songs: skips missing tracks, episodes and artist-less items
const toPlaylistTracks = (items: PlaylistItem[]): PlaylistTrack[] =>
  items
    .map((i) => i.item ?? i.track)
    .filter((t): t is Track => !!t && (t.type ?? "track") === "track" && t.artists.length > 0)
    .map((t) => ({
      // local files have no id
      key: t.id ?? `local:${t.artists[0].name}|${t.name}`.toLowerCase(),
      uri: t.uri ?? null,
      name: t.name,
      artists: t.artists.map((a) => a.name),
      ...(t.artists[0].id && { artistId: t.artists[0].id }),
    }));

export const getPlaylistTracksPage = (playlistId: string, offset: number, token: string, limit = PAGE_SIZE) =>
  getPage<PlaylistItem, PlaylistTrack>(
    `/playlists/${playlistId}/items?additional_types=track`,
    offset,
    token,
    toPlaylistTracks,
    limit,
  );

// Liked songs behave like a playlist with this id in the UI and the analysis queue
export const LIKED_ID = "liked";

export const getLikedTracksPage = (offset: number, token: string, limit = PAGE_SIZE) =>
  getPage<PlaylistItem, PlaylistTrack>("/me/tracks", offset, token, toPlaylistTracks, limit);

export type LikedSummary = { total: number; firstAddedAt: string | null };

// Liked songs have no snapshot_id; total + newest added_at stands in for it
export async function getLikedSummary(token: string): Promise<ApiResult<LikedSummary>> {
  const r = await spotifyGet<Page<{ added_at?: string }>>("/me/tracks?limit=1", token);
  if (!r.ok) return r;
  return { ok: true, data: { total: r.data.total, firstAddedAt: r.data.items[0]?.added_at ?? null } };
}

// The API only returns items for playlists the user owns or collaborates on
export function isReadablePlaylist(p: Playlist | null, myId: string): p is Playlist {
  return !!p && (p.owner.id === myId || p.collaborative);
}
