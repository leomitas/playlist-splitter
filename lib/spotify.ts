// Server-side Spotify access: one HTTP request per call, no retries.
// Queueing, 429 retries and caching live in the browser (lib/spotify-client.ts).

const API = "https://api.spotify.com/v1";
const PAGE_SIZE = 50;

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
type PlaylistItem = { item?: Track | null; track?: Track | null };
type Page<T> = { items: T[]; total: number; next: string | null };

export type ApiError = {
  method?: string;
  url: string;
  status: number | null;
  raw: string;
  // seconds, from the Retry-After header of a 429
  retryAfter?: number;
};
export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiError);

export type PageResult<T> = { items: T[]; total: number; nextOffset: number | null };
export type PlaylistTrack = { key: string; uri: string | null; name: string; artists: string[] };

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
): Promise<ApiResult<PageResult<R>>> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await spotifyGet<Page<T>>(`${path}${sep}limit=${PAGE_SIZE}&offset=${offset}`, token);
  if (!r.ok) return r;
  const next = offset + r.data.items.length;
  return {
    ok: true,
    data: {
      items: map(r.data.items),
      total: r.data.total,
      nextOffset: r.data.next && r.data.items.length > 0 ? next : null,
    },
  };
}

export const getPlaylistsPage = (offset: number, token: string) =>
  getPage<Playlist | null, Playlist>("/me/playlists", offset, token, (items) =>
    items.filter((p): p is Playlist => !!p),
  );

export const getPlaylistTracksPage = (playlistId: string, offset: number, token: string) =>
  getPage<PlaylistItem, PlaylistTrack>(
    `/playlists/${playlistId}/items?additional_types=track`,
    offset,
    token,
    (items) =>
      items
        .map((i) => i.item ?? i.track)
        .filter((t): t is Track => !!t && (t.type ?? "track") === "track" && t.artists.length > 0)
        .map((t) => ({
          // local files have no id
          key: t.id ?? `local:${t.artists[0].name}|${t.name}`.toLowerCase(),
          uri: t.uri ?? null,
          name: t.name,
          artists: t.artists.map((a) => a.name),
        })),
  );

// The API only returns items for playlists the user owns or collaborates on
export function isReadablePlaylist(p: Playlist | null, myId: string): p is Playlist {
  return !!p && (p.owner.id === myId || p.collaborative);
}
