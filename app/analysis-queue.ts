// Background "analyze everything" run: one playlist at a time, results added incrementally,
// state persisted in IndexedDB so a reload resumes (paused) where it stopped.
// Read-only: only GETs to Spotify and Last.fm.

import { classifyTrack, hasFamilyTag, type ClassifiedTrack } from "@/lib/classify";
import { idbClear, idbGet, idbSet } from "@/lib/idb";
import { readNewSince, trackIdentity } from "@/lib/incremental-sync";
import { getArtistTags, getTrackTags } from "@/lib/lastfm-client";
import type { Lookup } from "@/lib/lastfm";
import type { SkippedItem } from "@/lib/paged-reader";
import { LIKED_ID, type ApiError, type Playlist, type PlaylistTrack } from "@/lib/spotify";
import { clearSessionCache } from "@/lib/spotify-cache";
import { spotify } from "@/lib/spotify-client";
import { getLikedPage } from "./actions";
import { forgetTracks, getCachedTracks, likedSnapshot, loadTracks, rememberLikedSummary, saveCachedTracks } from "./spotify-data";

export type ItemStatus = "pendente" | "analisando" | "concluída" | "erro" | "cancelada";

export type RunItem = {
  id: string;
  name: string;
  snapshotId: string;
  // track count from the playlist list, used for the time estimate
  total: number | null;
  status: ItemStatus;
  error?: ApiError;
  errorCount?: number;
  // items the Spotify API kept failing on (5xx), skipped so the rest could be read
  skipped?: SkippedItem[];
  // tracks classified without tags because their Last.fm lookup failed or was impossible
  untagged?: UntaggedTrack[];
  // for the time estimate: how long the playlist took and how many tracks it had
  ms?: number;
  trackCount?: number;
};

export type UntaggedTrack = {
  name: string;
  artist: string;
  reason: "entrada inválida" | "erro do Last.fm";
  detail: string;
};

// 4xx = the input itself is the problem; 429 (after retries), 5xx and network = Last.fm trouble
const lookupFailureReason = (e: ApiError): UntaggedTrack["reason"] =>
  e.status !== null && e.status >= 400 && e.status < 500 && e.status !== 429 ? "entrada inválida" : "erro do Last.fm";

export type RunPhase = "running" | "paused" | "done" | "cancelled";

export type Run = {
  id: string;
  phase: RunPhase;
  items: RunItem[];
  // unique tracks, classified, in arrival order
  tracks: ClassifiedTrack[];
  // all tracks read, duplicates included
  totalTracks: number;
  // progress inside the playlist being analyzed (not persisted)
  current?: { step: "faixas" | "gêneros"; done: number; total: number | null };
  // last "Sincronizar curtidas"
  sync?: LikedSync;
};

export type LikedSync =
  | { state: "lendo"; fresh: number }
  | { state: "gêneros"; done: number; total: number }
  | { state: "concluída"; added: number; at: number }
  | { state: "erro"; error: ApiError };

const RUN_KEY = "run";

let run: Run | null = null;
let restored = false;
const listeners = new Set<() => void>();
// bumped on cancel / new run; work from an older generation stops and is discarded
let generation = 0;
let workerGeneration = -1;
let resumeWaiters: (() => void)[] = [];

function set(next: Run | null) {
  run = next;
  listeners.forEach((l) => l());
}

function persist() {
  if (!run) return;
  void idbSet("state", RUN_KEY, { ...run, current: undefined });
}

function patchItem(id: string, patch: Partial<RunItem>) {
  if (!run) return;
  set({ ...run, items: run.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
}

function wakeUp() {
  const ws = resumeWaiters;
  resumeWaiters = [];
  ws.forEach((r) => r());
}

// Awaited before every network call of the run: holds while paused, true means stop
async function checkpoint(gen: number) {
  while (gen === generation && run?.phase === "paused") await new Promise<void>((r) => resumeWaiters.push(r));
  return gen !== generation;
}

const playlistTotal = (p: Playlist) => (p.items ?? p.tracks)?.total ?? null;

// Last.fm lookups + classification for tracks not seen before in the run. Per-track failures
// never fail the batch; only a lost session does (every lookup would fail, so continuing would
// just mark everything "sem tags").
async function classifyFresh(fresh: PlaylistTrack[], stop: () => Promise<boolean>, onDone: (done: number) => void) {
  let fatal: ApiError | null = null;
  const untagged: UntaggedTrack[] = [];
  const noteFailure = (t: PlaylistTrack, e: ApiError, what: "artista" | "faixa") => {
    if (e.status === 401) fatal ??= e;
    else
      untagged.push({
        name: t.name,
        artist: t.artists[0] ?? "",
        reason: lookupFailureReason(e),
        detail: `${what}: ${e.status ?? "sem resposta"} ${e.raw}`.slice(0, 300),
      });
  };
  let done = 0;

  const classified = await Promise.all(
    fresh.map(async (t) => {
      const artist = (t.artists[0] ?? "").trim();
      let artistTags: Lookup | null = null;
      let trackTags: Lookup | null = null;

      if (!artist) {
        // Spotify returns name "" and artist "" for unavailable tracks; nothing to look up
        untagged.push({ name: t.name, artist: "", reason: "entrada inválida", detail: "artista vazio" });
      } else {
        const a = await getArtistTags(artist, stop);
        if (a.ok) artistTags = a.data;
        else noteFailure(t, a, "artista");

        // track tags only when the artist's tags don't already give a family
        if (a.ok && !hasFamilyTag(artistTags) && t.name.trim()) {
          const tr = await getTrackTags(artist, t.name.trim(), stop);
          if (tr.ok) trackTags = tr.data;
          else noteFailure(t, tr, "faixa");
        }
      }

      onDone(++done);
      return classifyTrack({ key: t.key, uri: t.uri, name: t.name, artist, artistId: t.artistId, artistTags, trackTags });
    }),
  );
  return { classified, untagged, fatal: fatal as ApiError | null };
}

// dedupe within the batch and against everything already analyzed
function unseen(tracks: PlaylistTrack[]) {
  const seen = new Set(run!.tracks.map((t) => t.key));
  const fresh: PlaylistTrack[] = [];
  for (const t of tracks) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    fresh.push(t);
  }
  return fresh;
}

async function analyzePlaylist(item: RunItem, gen: number) {
  const stop = () => checkpoint(gen);
  const stale = () => gen !== generation;
  const started = Date.now();

  patchItem(item.id, { status: "analisando", error: undefined, errorCount: undefined, skipped: undefined, untagged: undefined });
  set({ ...run!, current: { step: "faixas", done: 0, total: item.total } });

  const read = await loadTracks(
    { id: item.id, snapshot_id: item.snapshotId, total: item.total },
    {
      checkpoint: stop,
      onProgress: (done, total) => !stale() && set({ ...run!, current: { step: "faixas", done, total } }),
    },
  );
  if (stale()) return;
  if (!read.ok) {
    if (read.blockedUntil) {
      // Spotify blocked the app: stop here and keep the playlist queued; "Retomar" is
      // available again once the block ends. Pages already read are kept.
      patchItem(item.id, { status: "pendente" });
      set({ ...run!, phase: "paused", current: undefined });
    } else {
      patchItem(item.id, { status: "erro", error: read, errorCount: 1 });
      set({ ...run!, current: undefined });
    }
    persist();
    return;
  }

  const fresh = unseen(read.data.tracks);
  set({ ...run!, current: { step: "gêneros", done: 0, total: fresh.length } });
  const { classified, untagged, fatal } = await classifyFresh(
    fresh,
    stop,
    (done) => !stale() && set({ ...run!, current: { step: "gêneros", done, total: fresh.length } }),
  );
  if (stale()) return;

  if (fatal) {
    // nothing from this playlist is added; successful lookups are cached, so a retry is cheap
    patchItem(item.id, { status: "erro", error: fatal, errorCount: 1 });
  } else {
    set({ ...run!, tracks: [...run!.tracks, ...classified], totalTracks: run!.totalTracks + read.data.tracks.length });
    patchItem(item.id, {
      status: "concluída",
      ms: Date.now() - started,
      trackCount: read.data.tracks.length,
      skipped: read.data.skipped,
      untagged,
    });
  }
  set({ ...run!, current: undefined });
  persist();
}

async function work(gen: number) {
  workerGeneration = gen;
  try {
    for (;;) {
      if (await checkpoint(gen)) return;
      const item = run?.items.find((i) => i.status === "pendente");
      if (!item) {
        if (run) set({ ...run, phase: "done" });
        persist();
        return;
      }
      await analyzePlaylist(item, gen);
    }
  } finally {
    if (workerGeneration === gen) workerGeneration = -1;
  }
}

function ensureWorker() {
  if (workerGeneration !== generation) void work(generation);
}

export const analysis = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => run,

  // A run interrupted by a reload comes back paused
  async restore() {
    if (restored) return;
    restored = true;
    const saved = await idbGet<Run>("state", RUN_KEY);
    if (!saved || run) return;
    const interrupted = saved.phase === "running" || saved.phase === "paused";
    const syncInterrupted = saved.sync?.state === "lendo" || saved.sync?.state === "gêneros";
    set({
      ...saved,
      phase: interrupted ? "paused" : saved.phase,
      sync: syncInterrupted ? undefined : saved.sync,
      items: saved.items.map((i) => (i.status === "analisando" ? { ...i, status: "pendente" } : i)),
    });
  },

  start(playlists: Playlist[]) {
    if (run && (run.phase === "running" || run.phase === "paused")) return;
    const previous = run;
    generation++;
    wakeUp();
    set({
      id: crypto.randomUUID(),
      phase: "running",
      items: playlists.map((p) => ({
        id: p.id,
        name: p.name,
        snapshotId: p.snapshot_id,
        total: playlistTotal(p),
        status: "pendente",
      })),
      tracks: [],
      totalTracks: 0,
    });
    if (previous) {
      try {
        localStorage.removeItem(previewStorageKey(previous.id));
      } catch {
        // ignore
      }
    }
    persist();
    ensureWorker();
  },

  pause() {
    if (run?.phase !== "running") return;
    set({ ...run, phase: "paused" });
    persist();
  },

  // Also refreshes snapshot ids, in case a playlist changed while the run was stopped
  resume(current: Playlist[]) {
    if (run?.phase !== "paused") return;
    const byId = new Map(current.map((p) => [p.id, p]));
    set({
      ...run,
      phase: "running",
      items: run.items.map((i) => {
        const p = byId.get(i.id);
        return p && i.status === "pendente" ? { ...i, snapshotId: p.snapshot_id, total: playlistTotal(p) } : i;
      }),
    });
    persist();
    wakeUp();
    ensureWorker();
  },

  cancel() {
    if (!run || (run.phase !== "running" && run.phase !== "paused")) return;
    generation++;
    set({
      ...run,
      phase: "cancelled",
      current: undefined,
      items: run.items.map((i) =>
        i.status === "pendente" || i.status === "analisando" ? { ...i, status: "cancelada" } : i,
      ),
    });
    wakeUp();
    persist();
  },

  reprocess(id: string) {
    if (!run) return;
    const item = run.items.find((i) => i.id === id);
    if (!item || (item.status !== "erro" && item.status !== "cancelada")) return;
    patchItem(id, { status: "pendente", error: undefined, errorCount: undefined });
    if (run.phase === "done" || run.phase === "cancelled") {
      set({ ...run, phase: "running" });
      ensureWorker();
    }
    persist();
  },

  async clearCache() {
    await idbClear("cache");
    clearSessionCache();
  },

  // "Sincronizar curtidas": reads liked songs newest first until a known track, classifies only
  // the new ones and adds them to the run. Unliked tracks aren't detected (full re-analysis does).
  async syncLiked() {
    const item = run?.items.find((i) => i.id === LIKED_ID);
    if (!run || !item || item.status !== "concluída" || run.phase === "running" || run.phase === "paused") return;
    if (run.sync?.state === "lendo" || run.sync?.state === "gêneros") return;
    const gen = generation;
    const stale = () => gen !== generation;
    const setSync = (sync: LikedSync) => !stale() && set({ ...run!, sync });

    const cachedLiked = await getCachedTracks(LIKED_ID);
    if (!cachedLiked) {
      setSync({
        state: "erro",
        error: { url: "/me/tracks", status: null, raw: "Faixas curtidas não estão no cache deste navegador. Use a reanálise completa." },
      });
      return;
    }

    setSync({ state: "lendo", fresh: 0 });
    const read = await readNewSince({
      fetchPage: (offset, limit) => spotify.call(() => getLikedPage(offset, limit), "/me/tracks"),
      known: new Set(cachedLiked.tracks.map(trackIdentity)),
      checkpoint: async () => stale(),
      onProgress: (fresh) => setSync({ state: "lendo", fresh }),
    });
    if (stale()) return;
    if (!read.ok) {
      setSync({ state: "erro", error: read });
      persist();
      return;
    }

    const { fresh: newLiked, total, firstAddedAt } = read.data;
    const fresh = unseen(newLiked);
    setSync({ state: "gêneros", done: 0, total: fresh.length });
    const { classified, untagged, fatal } = await classifyFresh(
      fresh,
      async () => stale(),
      (done) => setSync({ state: "gêneros", done, total: fresh.length }),
    );
    if (stale()) return;
    if (fatal) {
      setSync({ state: "erro", error: fatal });
      persist();
      return;
    }

    // the new version marker, so neither the picker nor "Retomar" think liked songs changed
    const snapshotId = likedSnapshot({ total, firstAddedAt });
    await saveCachedTracks(LIKED_ID, { snapshotId, tracks: [...newLiked, ...cachedLiked.tracks], skipped: cachedLiked.skipped });
    rememberLikedSummary({ total, firstAddedAt });
    if (stale()) return;

    const current = run!.items.find((i) => i.id === LIKED_ID)!;
    set({
      ...run!,
      tracks: [...run!.tracks, ...classified],
      totalTracks: run!.totalTracks + newLiked.length,
      items: run!.items.map((i) =>
        i.id === LIKED_ID
          ? {
              ...i,
              snapshotId,
              total,
              trackCount: (current.trackCount ?? 0) + newLiked.length,
              untagged: [...(current.untagged ?? []), ...untagged],
            }
          : i,
      ),
      sync: { state: "concluída", added: classified.length, at: Date.now() },
    });
    persist();
  },

  // The secondary option: forgets the cached liked songs and analyzes the same playlists again
  async fullReanalyze(playlists: Playlist[]) {
    if (run && (run.phase === "running" || run.phase === "paused")) return;
    await forgetTracks(LIKED_ID);
    analysis.start(playlists);
  },
};

export const previewStorageKey = (runId: string) => `preview:${runId}`;

// Rough remaining time from the pace so far (ms per track over finished playlists)
export function estimateRemainingMs(r: Run): number | null {
  const finished = r.items.filter((i) => i.ms !== undefined && i.trackCount);
  if (finished.length === 0) return null;
  const ms = finished.reduce((n, i) => n + i.ms!, 0);
  const tracks = finished.reduce((n, i) => n + i.trackCount!, 0);
  const avgTracks = tracks / finished.length;
  const left = r.items
    .filter((i) => i.status === "pendente" || i.status === "analisando")
    .reduce((n, i) => n + (i.total ?? avgTracks), 0);
  return (ms / tracks) * left;
}
