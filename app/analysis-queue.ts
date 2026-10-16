// Background "analyze everything" run: one playlist at a time, results added incrementally,
// state persisted in IndexedDB so a reload resumes (paused) where it stopped.
// Read-only: only GETs to Spotify and Last.fm.

import { classifyTrack, hasFamilyTag, type ClassifiedTrack } from "@/lib/classify";
import { idbClear, idbGet, idbSet } from "@/lib/idb";
import { getArtistTags, getTrackTags } from "@/lib/lastfm-client";
import type { Lookup } from "@/lib/lastfm";
import type { ApiError, Playlist, PlaylistTrack } from "@/lib/spotify";
import { clearSessionCache } from "@/lib/spotify-cache";
import { loadTracks } from "./spotify-data";

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
  // for the time estimate: how long the playlist took and how many tracks it had
  ms?: number;
  trackCount?: number;
};

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
  current?: { step: "faixas" | "gêneros"; done: number; total: number };
};

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

async function analyzePlaylist(item: RunItem, gen: number) {
  const stop = () => checkpoint(gen);
  const stale = () => gen !== generation;
  const started = Date.now();

  patchItem(item.id, { status: "analisando", error: undefined, errorCount: undefined });
  set({ ...run!, current: { step: "faixas", done: 0, total: item.total ?? 0 } });

  const read = await loadTracks(
    { id: item.id, snapshot_id: item.snapshotId },
    {
      checkpoint: stop,
      onProgress: (done, total) => !stale() && set({ ...run!, current: { step: "faixas", done, total } }),
    },
  );
  if (stale()) return;
  if (!read.ok) {
    patchItem(item.id, { status: "erro", error: read, errorCount: 1 });
    set({ ...run!, current: undefined });
    persist();
    return;
  }

  // dedupe within the playlist and against everything already analyzed
  const seen = new Set(run!.tracks.map((t) => t.key));
  const fresh: PlaylistTrack[] = [];
  for (const t of read.data) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    fresh.push(t);
  }

  const errors: ApiError[] = [];
  let done = 0;
  set({ ...run!, current: { step: "gêneros", done: 0, total: fresh.length } });

  const classified = await Promise.all(
    fresh.map(async (t) => {
      const artist = t.artists[0];
      const a = await getArtistTags(artist, stop);
      if (!a.ok) errors.push(a);
      const artistTags: Lookup | null = a.ok ? a.data : null;

      // track tags only when the artist's tags don't already give a family
      let trackTags: Lookup | null = null;
      if (a.ok && !hasFamilyTag(artistTags)) {
        const tr = await getTrackTags(artist, t.name, stop);
        if (tr.ok) trackTags = tr.data;
        else errors.push(tr);
      }

      done++;
      if (!stale()) set({ ...run!, current: { step: "gêneros", done, total: fresh.length } });
      return classifyTrack({ key: t.key, uri: t.uri, name: t.name, artist, artistTags, trackTags });
    }),
  );
  if (stale()) return;

  if (errors.length > 0) {
    // nothing from this playlist is added; successful lookups are cached, so a retry is cheap
    patchItem(item.id, { status: "erro", error: errors[0], errorCount: errors.length });
  } else {
    set({ ...run!, tracks: [...run!.tracks, ...classified], totalTracks: run!.totalTracks + read.data.length });
    patchItem(item.id, { status: "concluída", ms: Date.now() - started, trackCount: read.data.length });
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
    set({
      ...saved,
      phase: interrupted ? "paused" : saved.phase,
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
