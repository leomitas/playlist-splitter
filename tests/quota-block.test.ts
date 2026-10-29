import { describe, expect, it, vi } from "vitest";
import { blockLeft, createBlockStore, formatBlockEnd } from "@/lib/quota-block";
import { createRequestQueue } from "@/lib/request-queue";
import type { ApiResult } from "@/lib/spotify";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const rateLimited = (retryAfter: number): ApiResult<never> => ({
  ok: false,
  url: "/me/playlists",
  status: 429,
  raw: '{"error":{"status":429,"message":"QUOTA_EXCEEDED"}}',
  retryAfter,
});

function setup(now = 1_000_000) {
  const storage = memoryStorage();
  const clock = { now };
  const block = createBlockStore(() => storage, () => clock.now);
  const sleep = vi.fn(async (ms: number) => void (clock.now += ms));
  const queue = createRequestQueue({ intervalMs: 0, block, sleep, now: () => clock.now, shouldRetry: (e) => e.status === 429 });
  return { storage, clock, block, sleep, queue };
}

describe("long Retry-After blocks instead of retrying", () => {
  it("does not retry a 429 with Retry-After over 120 s and refuses later calls without calling", async () => {
    const { block, queue, clock } = setup();
    const fn = vi.fn(async () => rateLimited(4 * 3600));

    const first = await queue.call(fn, "/me/playlists");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(first.ok).toBe(false);
    expect(!first.ok && first.blockedUntil).toBe(clock.now + 4 * 3600 * 1000);
    expect(block.get()).toBe(clock.now + 4 * 3600 * 1000);

    const other = vi.fn(async () => ({ ok: true as const, data: 1 }));
    const second = await queue.call(other, "/me");
    expect(other).not.toHaveBeenCalled();
    expect(!second.ok && second.status).toBe(429);
  });

  it("a short Retry-After (<= 120 s) is still an automatic pause and retry", async () => {
    const { block, queue, sleep } = setup();
    const fn = vi
      .fn<() => Promise<ApiResult<number>>>()
      .mockResolvedValueOnce(rateLimited(120))
      .mockResolvedValueOnce({ ok: true, data: 7 });

    const r = await queue.call(fn, "/me");
    expect(r).toEqual({ ok: true, data: 7 });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(120_000);
    expect(block.get()).toBeNull();
  });

  it("the block survives a reload (new store, same storage) and ends on time", () => {
    const { storage, block, clock } = setup();
    block.set(clock.now + 90 * 60_000);

    const reloaded = createBlockStore(() => storage, () => clock.now);
    expect(reloaded.get()).toBe(clock.now + 90 * 60_000);

    clock.now += 90 * 60_000;
    expect(reloaded.get()).toBeNull();
  });

  it("storage that throws doesn't break the block", () => {
    const broken = () => {
      throw new Error("blocked storage");
    };
    const block = createBlockStore(broken, () => 0);
    block.set(60_000);
    expect(block.get()).toBe(60_000);
  });

  it("formats the time left", () => {
    expect(blockLeft(30_000)).toEqual({ hours: 0, minutes: 1 });
    expect(blockLeft(0)).toBeNull();
    expect(blockLeft(125 * 60_000)).toEqual({ hours: 2, minutes: 5 });
  });

  it("formats the end time per locale, with the date only on another day", () => {
    const now = new Date(2026, 9, 18, 9, 0).getTime();
    expect(formatBlockEnd(new Date(2026, 9, 18, 14, 5).getTime(), now, "pt-BR")).toBe("14:05");
    expect(formatBlockEnd(new Date(2026, 9, 19, 14, 5).getTime(), now, "pt-BR")).toBe("19/10, 14:05");
    expect(formatBlockEnd(new Date(2026, 9, 18, 14, 5).getTime(), now, "en")).toBe("02:05 PM");
  });
});
