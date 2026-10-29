// "Testar configuração": checks each variable, the Spotify Client ID/Secret (client credentials
// flow, which doesn't use the user's Web API quota) and the Last.fm key (one read call).
// Answers are only ok / failed + a hint code. Values are never returned, logged or stored.
// The labels and hints shown to the user live in the dictionaries (setup.check.*, setup.hint.*).

import { envPresence, LOCAL_URL, REQUIRED_ENV, type EnvName } from "@/lib/env-check";

export type CheckHint =
  | "missing-env"
  | "auth-url"
  | "auth-secret"
  | "spotify-credentials"
  | "spotify-429"
  | "spotify-status"
  | "spotify-network"
  | "lastfm-key"
  | "lastfm-limit"
  | "lastfm-status"
  | "lastfm-network";

// id: a variable name, "auth-url", "auth-secret", "spotify" or "lastfm"; status: the HTTP
// status for the *-status hints
export type Check = { id: string; ok: boolean; hint?: CheckHint; status?: number };

type Env = Record<string, string | undefined>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function checkSpotify(env: Env, fetchFn: Fetch): Promise<Check> {
  const id = "spotify";
  const basic = Buffer.from(`${env.AUTH_SPOTIFY_ID}:${env.AUTH_SPOTIFY_SECRET}`).toString("base64");
  try {
    const res = await fetchFn("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      cache: "no-store",
    });
    // the body (it holds a token on success) is drained and dropped
    await res.text().catch(() => "");
    if (res.ok) return { id, ok: true };
    if (res.status === 400 || res.status === 401) return { id, ok: false, hint: "spotify-credentials" };
    if (res.status === 429) return { id, ok: false, hint: "spotify-429" };
    return { id, ok: false, hint: "spotify-status", status: res.status };
  } catch {
    return { id, ok: false, hint: "spotify-network" };
  }
}

async function checkLastfm(env: Env, fetchFn: Fetch): Promise<Check> {
  const id = "lastfm";
  const q = new URLSearchParams({ method: "tag.getInfo", tag: "rock", format: "json", api_key: env.LASTFM_API_KEY ?? "" });
  try {
    const res = await fetchFn(`https://ws.audioscrobbler.com/2.0/?${q}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { error?: number } | null;
    if (res.ok && body && !body.error) return { id, ok: true };
    // 10 = invalid API key, 26 = suspended key
    if (body?.error === 10 || body?.error === 26) return { id, ok: false, hint: "lastfm-key" };
    if (body?.error === 29) return { id, ok: false, hint: "lastfm-limit" };
    return { id, ok: false, hint: "lastfm-status", status: res.status };
  } catch {
    return { id, ok: false, hint: "lastfm-network" };
  }
}

export async function runConfigTest(env: Env, fetchFn: Fetch = fetch): Promise<Check[]> {
  const present = envPresence(env);
  const checks: Check[] = REQUIRED_ENV.map((name: EnvName) => ({
    id: name,
    ok: present[name],
    ...(!present[name] && { hint: "missing-env" as const }),
  }));

  if (present.AUTH_URL) {
    const ok = env.AUTH_URL!.trim().replace(/\/$/, "") === LOCAL_URL;
    checks.push({ id: "auth-url", ok, ...(!ok && { hint: "auth-url" as const }) });
  }
  if (present.AUTH_SECRET) {
    const ok = env.AUTH_SECRET!.trim().length >= 32;
    checks.push({ id: "auth-secret", ok, ...(!ok && { hint: "auth-secret" as const }) });
  }

  const [spotify, lastfm] = await Promise.all([
    present.AUTH_SPOTIFY_ID && present.AUTH_SPOTIFY_SECRET ? checkSpotify(env, fetchFn) : null,
    present.LASTFM_API_KEY ? checkLastfm(env, fetchFn) : null,
  ]);
  if (spotify) checks.push(spotify);
  if (lastfm) checks.push(lastfm);
  return checks;
}
