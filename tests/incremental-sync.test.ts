import { describe, expect, it, vi } from "vitest";
import { readNewSince, SYNC_PAGE, trackIdentity } from "@/lib/incremental-sync";
import type { ApiResult, PageResult, PlaylistTrack } from "@/lib/spotify";

const liked = (i: number): PlaylistTrack => ({
  key: `id${i}`,
  uri: `spotify:track:${String(i).padStart(22, "0")}`,
  name: `Song ${i}`,
  artists: ["Artist"],
});

// Liked songs newest first: index 0 is the most recent like
function library(total: number) {
  const all = Array.from({ length: total }, (_, i) => liked(i));
  const fetchPage = vi.fn(async (offset: number, limit: number): Promise<ApiResult<PageResult<PlaylistTrack>>> => {
    const items = all.slice(offset, offset + limit);
    const next = offset + items.length;
    return {
      ok: true,
      data: { items, total, nextOffset: next < total ? next : null, firstAddedAt: offset === 0 ? "2026-10-17T10:00:00Z" : undefined },
    };
  });
  return { all, fetchPage };
}

describe("readNewSince", () => {
  it("stops at the first known track and returns only the new ones", async () => {
    const { all, fetchPage } = library(500);
    // 60 new likes since the last read: the old library starts at index 60
    const known = new Set(all.slice(60).map(trackIdentity));

    const r = await readNewSince({ fetchPage, known });
    expect(r.ok && r.data.fresh.map((t) => t.key)).toEqual(all.slice(0, 60).map((t) => t.key));
    expect(r.ok && r.data.pages).toBe(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, SYNC_PAGE);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 50, SYNC_PAGE);
    expect(r.ok && r.data.firstAddedAt).toBe("2026-10-17T10:00:00Z");
  });

  it("nothing new costs a single page", async () => {
    const { all, fetchPage } = library(500);
    const r = await readNewSince({ fetchPage, known: new Set(all.map(trackIdentity)) });
    expect(r.ok && r.data.fresh).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("propagates an error (e.g. a block) without reading further", async () => {
    const fetchPage = vi.fn(async () => ({ ok: false as const, url: "/me/tracks", status: 429, raw: "", blockedUntil: 1 }));
    const r = await readNewSince({ fetchPage, known: new Set() });
    expect(r.ok).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("local files are identified by key", () => {
    expect(trackIdentity({ key: "local:a|b", uri: null })).toBe("local:a|b");
  });
});
