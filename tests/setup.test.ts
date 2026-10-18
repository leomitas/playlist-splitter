import { describe, expect, it, vi } from "vitest";
import { runConfigTest } from "@/lib/config-test";
import { missingEnv } from "@/lib/env-check";
import { matchApiError, matchAuthError } from "@/lib/known-errors";
import { proxy } from "@/proxy";

// fake values: they must never show up in what the test returns
const ENV = {
  AUTH_SPOTIFY_ID: "id-0123456789abcdef0123456789abcdef",
  AUTH_SPOTIFY_SECRET: "secret-fedcba9876543210fedcba98765432",
  AUTH_SECRET: "auth-secret-0123456789abcdefghijklmnopqrstuv",
  AUTH_URL: "http://127.0.0.1:3000",
  LASTFM_API_KEY: "lastfm-0123456789abcdef0123456789ab",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(spotifyStatus: number, lastfmBody: unknown) {
  return vi.fn(async (url: string) =>
    url.startsWith("https://accounts.spotify.com")
      ? json(spotifyStatus === 200 ? { access_token: "tok-SHOULD-NOT-LEAK" } : { error: "invalid_client" }, spotifyStatus)
      : json(lastfmBody),
  );
}

describe("runConfigTest", () => {
  it("all ok, and no value (nor the Spotify token) is returned", async () => {
    const fetchFn = fakeFetch(200, { tag: { name: "rock" } });
    const checks = await runConfigTest(ENV, fetchFn);
    expect(checks.every((c) => c.ok)).toBe(true);

    const out = JSON.stringify(checks);
    for (const v of [...Object.values(ENV).filter((v) => !v.startsWith("http")), "tok-SHOULD-NOT-LEAK"]) {
      expect(out).not.toContain(v);
    }
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("wrong Spotify credentials and an invalid Last.fm key fail with a hint", async () => {
    const checks = await runConfigTest(ENV, fakeFetch(400, { error: 10, message: "Invalid API key" }));
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId.spotify.ok).toBe(false);
    expect(byId.spotify.hint).toMatch(/Client ID ou Client Secret/);
    expect(byId.lastfm.ok).toBe(false);
    expect(byId.lastfm.hint).toMatch(/API key/);
  });

  it("missing variables skip the remote checks; localhost in AUTH_URL is flagged", async () => {
    const fetchFn = vi.fn();
    const checks = await runConfigTest({ AUTH_URL: "http://localhost:3000", AUTH_SECRET: "short" }, fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(checks.find((c) => c.id === "AUTH_SPOTIFY_ID")!.ok).toBe(false);
    expect(checks.find((c) => c.id === "auth-url")!.ok).toBe(false);
    expect(checks.find((c) => c.id === "auth-secret")!.ok).toBe(false);
  });

  it("network failure is a failed check, not a crash", async () => {
    const checks = await runConfigTest(ENV, vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(checks.find((c) => c.id === "spotify")!.ok).toBe(false);
    expect(checks.find((c) => c.id === "lastfm")!.ok).toBe(false);
  });
});

describe("missingEnv and the proxy", () => {
  it("lists what's missing (blank counts as missing)", () => {
    expect(missingEnv({ ...ENV, LASTFM_API_KEY: "  " })).toEqual(["LASTFM_API_KEY"]);
  });

  it("redirects pages to /setup keeping the 127.0.0.1 host, and answers 503 on API routes", () => {
    // what Next hands the proxy: nextUrl already rewritten to localhost, Host header intact
    const req = (path: string) =>
      ({ nextUrl: new URL(`http://localhost:3000${path}`), headers: new Headers({ host: "127.0.0.1:3000" }) }) as never;
    const saved = { ...process.env };
    for (const k of Object.keys(ENV)) delete process.env[k];
    try {
      const page = proxy(req("/")) as Response;
      expect(page.status).toBe(307);
      expect(page.headers.get("Location")).toBe(
        "http://127.0.0.1:3000/setup?missing=AUTH_SPOTIFY_ID,AUTH_SPOTIFY_SECRET,AUTH_SECRET,AUTH_URL,LASTFM_API_KEY",
      );
      const api = proxy(req("/api/lastfm")) as Response;
      expect(api.status).toBe(503);

      Object.assign(process.env, ENV);
      expect(proxy(req("/"))).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});

describe("known errors", () => {
  it("maps API errors to their fix", () => {
    expect(matchApiError({ status: 429, raw: "", blockedUntil: 1 })?.id).toBe("quota");
    expect(matchApiError({ status: 429, raw: '{"message":"QUOTA_EXCEEDED"}' })?.id).toBe("quota");
    expect(matchApiError({ status: 429, raw: "", retryAfter: 5 })).toBeNull();
    expect(matchApiError({ status: 403, raw: "Check settings on developer.spotify.com/dashboard, the user may not be registered." })?.id).toBe(
      "user-not-registered",
    );
    expect(matchApiError({ status: 403, raw: "Active premium subscription required for the owner of the app." })?.id).toBe("premium");
  });

  it("maps Auth.js error codes", () => {
    expect(matchAuthError("Configuration")?.id).toBe("restart");
    expect(matchAuthError("OAuthCallbackError")?.id).toBe("redirect-uri");
    expect(matchAuthError("Whatever")).toBeNull();
  });
});
