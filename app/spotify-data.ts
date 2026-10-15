// Browser-side loaders: every Spotify read goes through the queue (spotify.call) and the cache.

import { cacheKeys, cached, collectPages, invalidate } from "@/lib/spotify-cache";
import { spotify } from "@/lib/spotify-client";
import type { Playlist } from "@/lib/spotify";
import { getMe, getMyPlaylistsPage, getTracksPage } from "./actions";

export const loadMe = (force = false) => cached(cacheKeys.me, () => spotify.call(() => getMe(), "/me"), force);

export const loadPlaylists = (force = false) =>
  cached(
    cacheKeys.playlists,
    () => collectPages((offset) => spotify.call(() => getMyPlaylistsPage(offset), "/me/playlists")),
    force,
  );

export const invalidatePlaylists = () => invalidate(cacheKeys.playlists);

export const loadTracks = (playlist: Playlist, onProgress?: (done: number, total: number) => void) =>
  cached(cacheKeys.tracks(playlist.id, playlist.snapshot_id), () =>
    collectPages(
      (offset) => spotify.call(() => getTracksPage(playlist.id, offset), `/playlists/${playlist.id}/items`),
      onProgress,
    ),
  );
