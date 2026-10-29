// Browser-side loaders: every Spotify read goes through the queue (spotify.call) and a cache.

import type { GenreTargets } from "@/lib/existing-playlists";
import { idbDelete, idbGet, idbSet } from "@/lib/idb";
import { readAllPages, type ReadProgress, type ReadResult } from "@/lib/paged-reader";
import { DESCRIPTION } from "@/lib/playlist-plan";
import { cacheKeys, cached, collectPages, patchCached } from "@/lib/spotify-cache";
import { spotify, TEMPORARY_STATUS } from "@/lib/spotify-client";
import { LIKED_ID, type ApiResult, type LikedSummary, type Me, type Playlist } from "@/lib/spotify";
import { getLikedPage, getLikedSummaryAction, getMe, getMyPlaylistsPage, getTracksPage } from "./actions";

export const loadMe = (force = false) => cached(cacheKeys.me, () => spotify.call(() => getMe(), "/me"), force);

// One paginated listing per tab session; writes made by the app patch it instead of listing again
// ("Atualizar" forces a new listing)
export const loadPlaylists = (force = false) =>
  cached(
    cacheKeys.playlists,
    () => collectPages((offset) => spotify.call(() => getMyPlaylistsPage(offset), "/me/playlists")),
    force,
  );

export const loadLikedSummary = (force = false) =>
  cached(cacheKeys.liked, () => spotify.call(() => getLikedSummaryAction(), "/me/tracks"), force);

export const rememberLikedSummary = (summary: LikedSummary) => patchCached<LikedSummary>(cacheKeys.liked, () => summary);

// Playlists created (or updated) by the app, in IndexedDB: their URIs as of snapshotId, so
// updating one only reads it from Spotify again when its snapshot changed elsewhere
export type CreatedPlaylist = { id: string; name: string; snapshotId: string; uris: string[] };
const createdKey = (id: string) => `created:${id}`;

export const getCreated = (id: string) => idbGet<CreatedPlaylist>("cache", createdKey(id));

// Saves the playlist and patches the session's playlist list to match, so no new listing is needed
export async function rememberCreated(p: CreatedPlaylist, owner: Me) {
  await idbSet("cache", createdKey(p.id), p);
  patchCached<Playlist[]>(cacheKeys.playlists, (list) => {
    const entry: Playlist = {
      id: p.id,
      name: p.name,
      images: null,
      owner: { id: owner.id, display_name: owner.display_name },
      collaborative: false,
      description: DESCRIPTION,
      snapshot_id: p.snapshotId,
      items: { total: p.uris.length },
    };
    const i = list.findIndex((x) => x.id === p.id);
    if (i === -1) return [...list, entry];
    const copy = [...list];
    copy[i] = { ...list[i], snapshot_id: p.snapshotId, items: { total: p.uris.length } };
    return copy;
  });
}

// Genre -> playlist id per account, in the "state" store so "Limpar cache" keeps it
const targetsKey = (myId: string) => `genre-targets:${myId}`;

export const loadGenreTargets = async (myId: string): Promise<GenreTargets> =>
  (await idbGet<GenreTargets>("state", targetsKey(myId))) ?? {};

export async function rememberGenreTarget(myId: string, groupId: string, playlistId: string) {
  const current = await loadGenreTargets(myId);
  if (current[groupId] !== playlistId) await idbSet("state", targetsKey(myId), { ...current, [groupId]: playlistId });
}

// URIs of an app playlist: from the created-playlist cache when the snapshot still matches,
// otherwise read from Spotify (and cached for next time)
export async function loadCreatedUris(p: Playlist, owner: Me): Promise<ApiResult<string[]>> {
  const hit = await getCreated(p.id);
  if (hit && hit.snapshotId === p.snapshot_id) return { ok: true, data: hit.uris };
  const read = await loadTracks(p);
  if (!read.ok) return read;
  const uris = read.data.tracks.map((t) => t.uri).filter((u): u is string => !!u);
  await rememberCreated({ id: p.id, name: p.name, snapshotId: p.snapshot_id, uris }, owner);
  return { ok: true, data: uris };
}

// Liked songs as a playlist-shaped item, so selection, queue and cache treat them the same
export function likedAsPlaylist(summary: LikedSummary, me: Me): Playlist {
  return {
    id: LIKED_ID,
    // display name comes from the dictionary (by LIKED_ID); this one is only a fallback
    name: "Liked songs",
    images: null,
    owner: { id: me.id, display_name: me.display_name },
    collaborative: false,
    snapshot_id: likedSnapshot(summary),
    items: { total: summary.total },
  };
}

type CachedTracks = { snapshotId: string } & ReadResult;

export const getCachedTracks = (id: string) => idbGet<CachedTracks>("cache", `tracks:${id}`);
export const saveCachedTracks = (id: string, value: CachedTracks) => idbSet("cache", `tracks:${id}`, value);
// forces the next loadTracks to read everything again
export async function forgetTracks(id: string) {
  await idbDelete("cache", `tracks:${id}`);
  await idbDelete("cache", `progress:${id}`);
}

// Liked songs have no snapshot_id; total + newest added_at stands in for it
export const likedSnapshot = (s: LikedSummary) => `${s.total}|${s.firstAddedAt ?? ""}`;

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
  const progressKey = `progress:${playlist.id}`;
  const hit = await getCachedTracks(playlist.id);
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
    await saveCachedTracks(playlist.id, { snapshotId: playlist.snapshot_id, ...r.data });
    await idbDelete("cache", progressKey);
  }
  return r;
}
