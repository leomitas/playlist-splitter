// Browser-side loaders: every Spotify read goes through the queue (spotify.call) and a cache.

import { idbGet, idbSet } from "@/lib/idb";
import { cacheKeys, cached, collectPages, invalidate } from "@/lib/spotify-cache";
import { spotify } from "@/lib/spotify-client";
import type { ApiResult, Playlist, PlaylistTrack } from "@/lib/spotify";
import { getMe, getMyPlaylistsPage, getTracksPage } from "./actions";

export const loadMe = (force = false) => cached(cacheKeys.me, () => spotify.call(() => getMe(), "/me"), force);

export const loadPlaylists = (force = false) =>
  cached(
    cacheKeys.playlists,
    () => collectPages((offset) => spotify.call(() => getMyPlaylistsPage(offset), "/me/playlists")),
    force,
  );

export const invalidatePlaylists = () => invalidate(cacheKeys.playlists);

type CachedTracks = { snapshotId: string; tracks: PlaylistTrack[] };

// Persistent per playlist; only re-fetched when the snapshot_id changed
export async function loadTracks(
  playlist: Pick<Playlist, "id" | "snapshot_id">,
  opts: {
    onProgress?: (done: number, total: number) => void;
    // awaited before each page; waits while paused, resolves true to stop
    checkpoint?: () => Promise<boolean>;
  } = {},
): Promise<ApiResult<PlaylistTrack[]>> {
  const key = `tracks:${playlist.id}`;
  const hit = await idbGet<CachedTracks>("cache", key);
  if (hit && hit.snapshotId === playlist.snapshot_id) return { ok: true, data: hit.tracks };

  const url = `/playlists/${playlist.id}/items`;
  const r = await collectPages(async (offset) => {
    if (await opts.checkpoint?.()) return { ok: false, url, status: null, raw: "cancelado" };
    return spotify.call(() => getTracksPage(playlist.id, offset), url);
  }, opts.onProgress);
  if (r.ok) await idbSet("cache", key, { snapshotId: playlist.snapshot_id, tracks: r.data } satisfies CachedTracks);
  return r;
}
