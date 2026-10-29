// Background MusicBrainz lookups of artist countries: one request per second (queue with
// concurrency 1 + backoff), persistent cache per artist, pause/resume. Read-only.

import { isFresh, type CachedCountry } from "@/lib/country";
import { idbGet, idbSet } from "@/lib/idb";
import { createRequestQueue } from "@/lib/request-queue";
import type { ApiError, ApiResult } from "@/lib/spotify";

const INTERVAL_MS = 1100;

export const musicbrainz = createRequestQueue({
  concurrency: 1,
  intervalMs: INTERVAL_MS,
  maxRetries: 3,
  // MusicBrainz answers 503 when over its rate limit
  shouldRetry: (e) => e.status === null || e.status === 429 || e.status >= 500,
});

export type CountryState = {
  // countryKey -> country (null = not found / not confident)
  countries: Record<string, string | null>;
  phase: "idle" | "running" | "paused" | "done";
  // lookups of the current batch
  done: number;
  total: number;
  startedAt: number;
  failed: number;
  error?: ApiError;
};

let state: CountryState = { countries: {}, phase: "idle", done: 0, total: 0, startedAt: 0, failed: 0 };
const listeners = new Set<() => void>();
let queue: [key: string, name: string][] = [];
let working = false;
let resumeWaiters: (() => void)[] = [];

function set(patch: Partial<CountryState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const cacheKey = (key: string) => `mb:${key}`;

async function fetchCountry(name: string): Promise<ApiResult<{ country: string | null }>> {
  const res = await fetch(`/api/musicbrainz?${new URLSearchParams({ artist: name })}`, { cache: "no-store" });
  return (await res.json()) as ApiResult<{ country: string | null }>;
}

async function work() {
  if (working) return;
  working = true;
  try {
    while (queue.length > 0) {
      while (state.phase === "paused") await new Promise<void>((r) => resumeWaiters.push(r));
      const [key, name] = queue.shift()!;
      if (key in state.countries) {
        set({ done: state.done + 1 });
        continue;
      }
      const r = await musicbrainz.call(() => fetchCountry(name), "/api/musicbrainz");
      if (r.ok) {
        await idbSet("cache", cacheKey(key), { country: r.data.country, at: Date.now() } satisfies CachedCountry);
        set({ countries: { ...state.countries, [key]: r.data.country }, done: state.done + 1 });
      } else if (r.status === 401) {
        // session lost: every lookup would fail; the rest stays unknown until the next try
        queue = [];
        set({ error: r, phase: "done" });
        return;
      } else {
        // not cached, so it's asked again next time
        set({ done: state.done + 1, failed: state.failed + 1, error: r });
      }
    }
    if (state.phase === "running") set({ phase: "done" });
  } finally {
    working = false;
  }
}

export const countryLookup = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,

  // Loads cached countries for these artists and looks up the rest in the background
  async ensure(artists: Map<string, string>) {
    const missing: [string, string][] = [];
    const found: Record<string, string | null> = {};
    for (const [key, name] of artists) {
      if (key in state.countries || queue.some(([k]) => k === key)) continue;
      const hit = await idbGet<CachedCountry>("cache", cacheKey(key));
      if (isFresh(hit)) found[key] = hit!.country;
      else missing.push([key, name]);
    }
    if (Object.keys(found).length > 0) set({ countries: { ...state.countries, ...found } });
    if (missing.length === 0) return;

    const fresh = state.phase === "done" || state.phase === "idle";
    queue.push(...missing);
    set({
      phase: state.phase === "paused" ? "paused" : "running",
      ...(fresh
        ? { done: 0, total: missing.length, startedAt: Date.now(), failed: 0, error: undefined }
        : { total: state.total + missing.length }),
    });
    void work();
  },

  pause() {
    if (state.phase === "running") set({ phase: "paused" });
  },

  resume() {
    if (state.phase !== "paused") return;
    set({ phase: "running" });
    const ws = resumeWaiters;
    resumeWaiters = [];
    ws.forEach((r) => r());
  },

  // forgets what's in memory (the IndexedDB cache is cleared separately)
  reset() {
    queue = [];
    set({ countries: {}, phase: "idle", done: 0, total: 0, startedAt: 0, failed: 0, error: undefined });
  },
};

// Remaining time from the pace so far, or from the interval before the first answer
export function countryEtaMs(s: CountryState, now = Date.now()) {
  const left = s.total - s.done;
  if (left <= 0) return 0;
  const perCall = s.done > 0 ? (now - s.startedAt) / s.done : INTERVAL_MS;
  return Math.max(perCall, INTERVAL_MS) * left;
}
