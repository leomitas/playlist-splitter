// Single entry point for every Spotify call made from the browser (via server actions):
// one request at a time, 200ms apart, 429s pause the whole queue and are retried.

import { createRequestQueue } from "@/lib/request-queue";

export type { RateLimitState } from "@/lib/request-queue";

export const spotify = createRequestQueue({ concurrency: 1, intervalMs: 200 });
