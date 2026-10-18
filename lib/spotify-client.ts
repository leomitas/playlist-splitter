// Single entry point for every Spotify call made from the browser (via server actions):
// one request at a time, 200ms apart. 429s and temporary 5xx pause the whole queue and are
// retried with backoff (2s, 4s, 8s, 16s; 5 attempts in total). A 429 asking for more than
// 120 s blocks every call until it ends (lib/quota-block.ts).

import { createBlockStore } from "@/lib/quota-block";
import { createRequestQueue } from "@/lib/request-queue";

export type { RateLimitState } from "@/lib/request-queue";

export const TEMPORARY_STATUS = new Set([429, 500, 502, 503, 504]);

export const spotifyBlock = createBlockStore();

export const spotify = createRequestQueue({
  concurrency: 1,
  intervalMs: 200,
  maxRetries: 4,
  shouldRetry: (e) => e.status !== null && TEMPORARY_STATUS.has(e.status),
  block: spotifyBlock,
});
