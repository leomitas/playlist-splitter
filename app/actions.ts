"use server";

// Each Spotify action performs exactly one HTTP request; the browser queues them and
// handles 429 retries (lib/spotify-client.ts). The access token never leaves the server.

import { auth } from "@/auth";
import { BATCH_SIZE, DESCRIPTION, TRACK_URI } from "@/lib/playlist-plan";
import {
  getPlaylistsPage,
  getLikedSummary,
  getLikedTracksPage,
  getPlaylistTracksPage,
  PAGE_SIZE,
  spotifyGet,
  spotifyPost,
  type ApiResult,
  type Me,
} from "@/lib/spotify";

const SPOTIFY_ID = /^[A-Za-z0-9]+$/;

// smaller pages are used to isolate an item the API keeps failing on
const pageLimit = (limit: number) => Math.min(PAGE_SIZE, Math.max(1, Math.floor(limit) || PAGE_SIZE));

async function token(): Promise<string | null> {
  const session = await auth();
  return session?.accessToken && !session.error ? session.accessToken : null;
}

const fail = (method: string, url: string, status: number | null, raw: string) =>
  ({ ok: false, method, url, status, raw }) as const;

const notAuthenticated = (method: string, url: string) =>
  fail(method, url, 401, "Sessão expirada ou ausente. Entre novamente.");

export async function getMe() {
  const t = await token();
  if (!t) return notAuthenticated("GET", "/me");
  return spotifyGet<Me>("/me", t);
}

export async function getMyPlaylistsPage(offset: number) {
  const t = await token();
  if (!t) return notAuthenticated("GET", "/me/playlists");
  return getPlaylistsPage(Math.max(0, Math.floor(offset)), t);
}

export async function getTracksPage(playlistId: string, offset: number, limit = PAGE_SIZE) {
  const url = `/playlists/${playlistId}/items`;
  const t = await token();
  if (!t) return notAuthenticated("GET", url);
  if (!SPOTIFY_ID.test(playlistId)) return fail("GET", url, null, "ID de playlist inválido.");
  return getPlaylistTracksPage(playlistId, Math.max(0, Math.floor(offset)), t, pageLimit(limit));
}

// Read-only: liked songs are never modified
export async function getLikedSummaryAction() {
  const t = await token();
  if (!t) return notAuthenticated("GET", "/me/tracks");
  return getLikedSummary(t);
}

export async function getLikedPage(offset: number, limit = PAGE_SIZE) {
  const t = await token();
  if (!t) return notAuthenticated("GET", "/me/tracks");
  return getLikedTracksPage(Math.max(0, Math.floor(offset)), t, pageLimit(limit));
}

export async function createPlaylist(
  name: string,
  isPublic: boolean,
): Promise<ApiResult<{ id: string; url: string; name: string; snapshot_id: string }>> {
  const t = await token();
  if (!t) return notAuthenticated("POST", "/me/playlists");

  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return fail("POST", "/me/playlists", null, "Nome vazio.");

  const res = await spotifyPost<{ id: string; external_urls: { spotify: string }; snapshot_id: string }>("/me/playlists", t, {
    name: trimmed,
    public: isPublic,
    description: DESCRIPTION,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    data: { id: res.data.id, url: res.data.external_urls.spotify, name: trimmed, snapshot_id: res.data.snapshot_id },
  };
}

// Appends only; never removes, reorders, renames or changes privacy
export async function addTracks(
  playlistId: string,
  uris: string[],
): Promise<ApiResult<{ snapshot_id: string }>> {
  const url = `/playlists/${playlistId}/items`;
  const t = await token();
  if (!t) return notAuthenticated("POST", url);

  if (!SPOTIFY_ID.test(playlistId) || uris.length === 0 || uris.length > BATCH_SIZE || !uris.every((u) => TRACK_URI.test(u))) {
    return fail("POST", url, null, "Lote inválido (ID, quantidade ou URI).");
  }
  return spotifyPost<{ snapshot_id: string }>(url, t, { uris });
}
