// Reads every page of a playlist (or liked songs), saving progress after each page so a retry
// resumes from the last offset. A window the API keeps failing on with temporary errors is
// re-read with smaller pages (10, then 1) so only the item that breaks it gets skipped.

import type { ApiError, ApiResult, PageResult, PlaylistTrack } from "@/lib/spotify";

const PAGE = 50;
const SUB_PAGE = 10;

export type SkippedItem = {
  offset: number;
  // last track read before the skipped one, to help find it in the Spotify app
  after: string | null;
};

export type ReadProgress = {
  snapshotId: string;
  nextOffset: number;
  total: number | null;
  done: boolean;
  tracks: PlaylistTrack[];
  skipped: SkippedItem[];
};

export type ReadResult = { tracks: PlaylistTrack[]; skipped: SkippedItem[] };

type Options = {
  snapshotId: string;
  // fallback when no page has been read yet (from the playlist list / liked summary)
  knownTotal: number | null;
  fetchPage: (offset: number, limit: number) => Promise<ApiResult<PageResult<PlaylistTrack>>>;
  // errors worth isolating (already retried by the queue): 5xx
  isTemporary: (e: ApiError) => boolean;
  loadProgress: () => Promise<ReadProgress | undefined>;
  saveProgress: (p: ReadProgress) => Promise<void>;
  // awaited before each request; resolves true to stop
  checkpoint?: () => Promise<boolean>;
  onProgress?: (done: number, total: number | null) => void;
};

export async function readAllPages(o: Options): Promise<ApiResult<ReadResult>> {
  const saved = await o.loadProgress();
  // progress from another version of the playlist would mix up offsets
  const st: ReadProgress =
    saved && saved.snapshotId === o.snapshotId
      ? saved
      : { snapshotId: o.snapshotId, nextOffset: 0, total: o.knownTotal, done: false, tracks: [], skipped: [] };
  const finished = () => st.done || (st.total !== null && st.nextOffset >= st.total);
  o.onProgress?.(st.nextOffset, st.total);

  // null = page read; otherwise the error
  async function read(limit: number): Promise<ApiError | null> {
    if (await o.checkpoint?.()) return { url: "", status: null, raw: "cancelado" };
    const r = await o.fetchPage(st.nextOffset, limit);
    if (!r.ok) return r;
    st.tracks.push(...r.data.items);
    st.total = r.data.total;
    if (r.data.nextOffset === null) st.done = true;
    else st.nextOffset = r.data.nextOffset;
    await o.saveProgress(st);
    o.onProgress?.(st.nextOffset, st.total);
    return null;
  }

  const toResult = (e: ApiError): ApiResult<ReadResult> => ({ ok: false, ...e });

  while (!finished()) {
    const err = await read(PAGE);
    if (!err) continue;
    // without a total there's no way to know how far to walk item by item
    if (!o.isTemporary(err) || st.total === null) return toResult(err);

    // poisoned window: isolate the failing item(s) with smaller pages
    const windowEnd = Math.min(st.nextOffset + PAGE, st.total);
    while (!finished() && st.nextOffset < windowEnd) {
      const subErr = await read(Math.min(SUB_PAGE, windowEnd - st.nextOffset));
      if (!subErr) continue;
      if (!o.isTemporary(subErr)) return toResult(subErr);

      const subEnd = Math.min(st.nextOffset + SUB_PAGE, windowEnd);
      while (!finished() && st.nextOffset < subEnd) {
        const oneErr = await read(1);
        if (!oneErr) continue;
        if (!o.isTemporary(oneErr)) return toResult(oneErr);
        const last = st.tracks.at(-1);
        st.skipped.push({ offset: st.nextOffset, after: last ? `${last.name} — ${last.artists.join(", ")}` : null });
        st.nextOffset++;
        await o.saveProgress(st);
        o.onProgress?.(st.nextOffset, st.total);
      }
    }
  }
  return { ok: true, data: { tracks: st.tracks, skipped: st.skipped } };
}
