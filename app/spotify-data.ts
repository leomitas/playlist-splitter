// Browser-side loaders: every Spotify read goes through the queue (spotify.call) and a cache.

import { idbDelete, idbGet, idbSet } from "@/lib/idb";
import { readAllPages, type ReadProgress, type ReadResult } from "@/lib/paged-reader";
import { cacheKeys, cached, collectPages, invalidate } from "@/lib/spotify-cache";
import { spotify, TEMPORARY_STATUS } from "@/lib/spotify-client";
import { LIKED_ID, type ApiResult, type LikedSummary, type Me, type Playlist } from "@/lib/spotify";
import { getLikedPage, getLikedSummaryAction, getMe, getMyPlaylistsPage, getTracksPage } from "./actions";

export const loadMe = (force = false) => cached(cacheKeys.me, () => spotify.call(() => getMe(), "/me"), force);

export const loadPlaylists = (force = false) =>
  cached(
    cacheKeys.playlists,
    () => collectPages((offset) => spotify.call(() => getMyPlaylistsPage(offset), "/me/playlists")),
    force,
  );

export const invalidatePlaylists = () => invalidate(cacheKeys.playlists);

export const loadLikedSummary = (force = false) =>
  cached(cacheKeys.liked, () => spotify.call(() => getLikedSummaryAction(), "/me/tracks"), force);

// Liked songs as a playlist-shaped item, so selection, queue and cache treat them the same
export function likedAsPlaylist(summary: LikedSummary, me: Me): Playlist {
  return {
    id: LIKED_ID,
    name: "Músicas curtidas",
    images: null,
    owner: { id: me.id, display_name: me.display_name },
    collaborative: false,
    snapshot_id: `${summary.total}|${summary.firstAddedAt ?? ""}`,
    items: { total: summary.total },
  };
}

type CachedTracks = { snapshotId: string } & ReadResult;

// Persistent per playlist; only re-fetched when the snapshot_id changed. Progress is saved
// page by page, so a failed or cancelled read resumes from the last offset read.
export async function loadTracks(
  playlist: Pick<Playlist, "id" | "snapshot_id"> & { total?: number | null },
  opts: {
    onProgress?: (done: number, total: number | null) => void;
    // awaited before each page; waits while paused, resolves true to stop
    checkpoint?: () => Promise<boolean>;
  } = {},
): Promise<ApiResult<ReadResult>> {
  const key = `tracks:${playlist.id}`;
  const progressKey = `progress:${playlist.id}`;
  const hit = await idbGet<CachedTracks>("cache", key);
  if (hit && hit.snapshotId === playlist.snapshot_id) {
    return { ok: true, data: { tracks: hit.tracks, skipped: hit.skipped ?? [] } };
  }

  const liked = playlist.id === LIKED_ID;
  const url = liked ? "/me/tracks" : `/playlists/${playlist.id}/items`;
  const r = await readAllPages({
    snapshotId: playlist.snapshot_id,
    knownTotal: playlist.total ?? null,
    fetchPage: (offset, limit) =>
      spotify.call(() => (liked ? getLikedPage(offset, limit) : getTracksPage(playlist.id, offset, limit)), url),
    isTemporary: (e) => e.status !== null && e.status >= 500 && TEMPORARY_STATUS.has(e.status),
    loadProgress: () => idbGet<ReadProgress>("cache", progressKey),
    saveProgress: (p) => idbSet("cache", progressKey, p),
    checkpoint: opts.checkpoint,
    onProgress: opts.onProgress,
  });
  if (r.ok) {
    await idbSet("cache", key, { snapshotId: playlist.snapshot_id, ...r.data } satisfies CachedTracks);
    await idbDelete("cache", progressKey);
  }
  return r;
}
