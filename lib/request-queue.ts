// Browser-side request queue: max concurrency, spacing between starts, retries with backoff
// (honouring Retry-After) that pause the whole queue.

import type { ApiError, ApiResult } from "@/lib/spotify";

type Options = {
  concurrency: number;
  intervalMs: number;
  maxRetries: number;
  minWaitS: number;
  shouldRetry: (error: ApiError) => boolean;
  sleep: (ms: number) => Promise<void>;
};

export type RateLimitState = { retryAt: number } | null;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createRequestQueue(overrides: Partial<Options> = {}) {
  const o: Options = {
    concurrency: 1,
    intervalMs: 200,
    maxRetries: 3,
    minWaitS: 2,
    shouldRetry: (e) => e.status === 429,
    sleep: realSleep,
    ...overrides,
  };

  let active = 0;
  let nextStart = 0;
  // after a retryable failure nobody starts until the wait has passed
  let pausedUntil = 0;
  const waiting: (() => void)[] = [];

  async function acquire() {
    if (active >= o.concurrency) await new Promise<void>((r) => waiting.push(r));
    else active++;
    for (;;) {
      // reserve a start slot at least intervalMs after the previous one
      const now = Date.now();
      const start = Math.max(now, nextStart, pausedUntil);
      if (start <= now) {
        nextStart = now + o.intervalMs;
        return;
      }
      await o.sleep(start - now);
    }
  }

  function release() {
    const next = waiting.shift();
    // hand the slot straight to the next caller; active count stays the same
    if (next) next();
    else active--;
  }

  // rate-limit notice for the UI (useSyncExternalStore-compatible)
  let rateLimit: RateLimitState = null;
  const listeners = new Set<() => void>();
  const setRateLimit = (s: RateLimitState) => {
    rateLimit = s;
    listeners.forEach((l) => l());
  };

  async function call<T>(fn: () => Promise<ApiResult<T>>, label: string): Promise<ApiResult<T>> {
    for (let attempt = 0; ; attempt++) {
      await acquire();
      let r: ApiResult<T>;
      try {
        r = await fn();
      } catch (err) {
        // server actions / fetch can throw (e.g. network drop)
        r = { ok: false, url: label, status: null, raw: String(err) };
      } finally {
        release();
      }
      if (r.ok || !o.shouldRetry(r) || attempt >= o.maxRetries) return r;

      // Retry-After (at least minWaitS), never shorter than the exponential backoff
      const waitS = Math.max(r.retryAfter ?? 0, o.minWaitS, o.minWaitS * 2 ** attempt);
      pausedUntil = Math.max(pausedUntil, Date.now() + waitS * 1000);
      setRateLimit({ retryAt: pausedUntil });
      await o.sleep(waitS * 1000);
      if (Date.now() >= pausedUntil) setRateLimit(null);
    }
  }

  return {
    call,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getRateLimit: () => rateLimit,
  };
}
