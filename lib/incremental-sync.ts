// Incremental read of liked songs: pages come newest first, so reading stops at the first track
// already known. Only additions are detected; unliked tracks need a full re-read.

import type { ApiResult, PageResult, PlaylistTrack } from "@/lib/spotify";

export const SYNC_PAGE = 50;

// URI identifies a track; local files have none, so their key stands in
export const trackIdentity = (t: Pick<PlaylistTrack, "uri" | "key">) => t.uri ?? t.key;

export type SyncRead = {
  // new tracks, newest first
  fresh: PlaylistTrack[];
  total: number;
  firstAddedAt: string | null;
  pages: number;
};

export async function readNewSince(o: {
  fetchPage: (offset: number, limit: number) => Promise<ApiResult<PageResult<PlaylistTrack>>>;
  known: Set<string>;
  checkpoint?: () => Promise<boolean>;
  onProgress?: (fresh: number) => void;
}): Promise<ApiResult<SyncRead>> {
  const fresh: PlaylistTrack[] = [];
  let offset: number | null = 0;
  let total = 0;
  let firstAddedAt: string | null = null;
  let pages = 0;

  while (offset !== null) {
    if (await o.checkpoint?.()) return { ok: false, url: "", status: null, raw: "cancelado" };
    const r = await o.fetchPage(offset, SYNC_PAGE);
    if (!r.ok) return r;
    if (pages === 0) {
      total = r.data.total;
      firstAddedAt = r.data.firstAddedAt ?? null;
    }
    pages++;
    for (const t of r.data.items) {
      if (o.known.has(trackIdentity(t))) return { ok: true, data: { fresh, total, firstAddedAt, pages } };
      fresh.push(t);
    }
    o.onProgress?.(fresh.length);
    offset = r.data.nextOffset;
  }
  return { ok: true, data: { fresh, total, firstAddedAt, pages } };
}
