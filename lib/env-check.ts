// Required environment variables. Only presence is ever checked or reported: values are never
// returned, logged or stored. No imports, so the proxy and /setup work when everything is missing.

export const LOCAL_URL = "http://127.0.0.1:3000";
export const REDIRECT_URI = `${LOCAL_URL}/api/auth/callback/spotify`;

export const REQUIRED_ENV = [
  "AUTH_SPOTIFY_ID",
  "AUTH_SPOTIFY_SECRET",
  "AUTH_SECRET",
  "AUTH_URL",
  "LASTFM_API_KEY",
] as const;

export type EnvName = (typeof REQUIRED_ENV)[number];

type Env = Record<string, string | undefined>;

export function missingEnv(env: Env = process.env): EnvName[] {
  return REQUIRED_ENV.filter((name) => !env[name]?.trim());
}

// name -> present?
export function envPresence(env: Env = process.env): Record<EnvName, boolean> {
  return Object.fromEntries(REQUIRED_ENV.map((name) => [name, !!env[name]?.trim()])) as Record<EnvName, boolean>;
}
