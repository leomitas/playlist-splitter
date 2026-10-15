// Per-tab cache (memory + sessionStorage) for Spotify reads.
// Playlist tracks are keyed by snapshot_id, so an unchanged playlist is never re-fetched.

import type { ApiResult, PageResult } from "@/lib/spotify";

const PREFIX = "sp:";
const mem = new Map<string, unknown>();

export const cacheKeys = {
  me: `${PREFIX}me`,
  playlists: `${PREFIX}playlists`,
  tracks: (playlistId: string, snapshotId: string) => `${PREFIX}tracks:${playlistId}:${snapshotId}`,
};

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | undefined {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const raw = storage()?.getItem(key);
    if (raw == null) return undefined;
    const value = JSON.parse(raw) as T;
    mem.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  mem.set(key, value);
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded / storage blocked: memory cache still works for this page load
  }
}

function removeWhere(match: (key: string) => boolean) {
  for (const k of [...mem.keys()]) if (match(k)) mem.delete(k);
  const s = storage();
  if (!s) return;
  try {
    const keys = Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k): k is string => !!k);
    for (const k of keys) if (match(k)) s.removeItem(k);
  } catch {
    // ignore
  }
}

export async function cached<T>(
  key: string,
  load: () => Promise<ApiResult<T>>,
  force = false,
): Promise<ApiResult<T>> {
  if (!force) {
    const hit = read<T>(key);
    if (hit !== undefined) return { ok: true, data: hit };
  }
  const r = await load();
  if (r.ok) {
    // keep only the latest snapshot of a playlist's tracks
    const m = key.match(/^sp:tracks:([^:]+):/);
    if (m) removeWhere((k) => k.startsWith(`${PREFIX}tracks:${m[1]}:`) && k !== key);
    write(key, r.data);
  }
  return r;
}

export function invalidate(key: string) {
  removeWhere((k) => k === key);
}

export async function collectPages<T>(
  fetchPage: (offset: number) => Promise<ApiResult<PageResult<T>>>,
  onProgress?: (done: number, total: number) => void,
): Promise<ApiResult<T[]>> {
  const all: T[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page: ApiResult<PageResult<T>> = await fetchPage(offset);
    if (!page.ok) return page;
    all.push(...page.data.items);
    offset = page.data.nextOffset;
    onProgress?.(offset ?? page.data.total, page.data.total);
  }
  return { ok: true, data: all };
}
