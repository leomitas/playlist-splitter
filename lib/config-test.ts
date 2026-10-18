// "Testar configuração": checks each variable, the Spotify Client ID/Secret (client credentials
// flow, which doesn't use the user's Web API quota) and the Last.fm key (one read call).
// Answers are only ok / failed + a hint. Values are never returned, logged or stored.

import { envPresence, LOCAL_URL, REQUIRED_ENV, type EnvName } from "@/lib/env-check";

export type Check = { id: string; label: string; ok: boolean; hint?: string };

type Env = Record<string, string | undefined>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const RESTART = "Se você já preencheu, reinicie o servidor (Ctrl+C e npm run dev).";

async function checkSpotify(env: Env, fetchFn: Fetch): Promise<Check> {
  const label = "Spotify aceita o Client ID e o Client Secret";
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
    if (res.ok) return { id: "spotify", label, ok: true };
    if (res.status === 400 || res.status === 401)
      return {
        id: "spotify",
        label,
        ok: false,
        hint: "Client ID ou Client Secret incorretos. Copie de novo em Dashboard > seu app > Settings (sem espaços).",
      };
    if (res.status === 429) return { id: "spotify", label, ok: false, hint: "O Spotify pediu uma pausa. Tente daqui a alguns minutos." };
    return { id: "spotify", label, ok: false, hint: `O Spotify respondeu ${res.status}. Tente de novo mais tarde.` };
  } catch {
    return { id: "spotify", label, ok: false, hint: "Sem conexão com accounts.spotify.com. Verifique a internet." };
  }
}

async function checkLastfm(env: Env, fetchFn: Fetch): Promise<Check> {
  const label = "Last.fm aceita a chave";
  const q = new URLSearchParams({ method: "tag.getInfo", tag: "rock", format: "json", api_key: env.LASTFM_API_KEY ?? "" });
  try {
    const res = await fetchFn(`https://ws.audioscrobbler.com/2.0/?${q}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { error?: number } | null;
    if (res.ok && body && !body.error) return { id: "lastfm", label, ok: true };
    // 10 = invalid API key, 26 = suspended key
    if (body?.error === 10 || body?.error === 26)
      return { id: "lastfm", label, ok: false, hint: "Chave inválida ou suspensa. Use a \"API key\" (não o \"Shared secret\")." };
    if (body?.error === 29) return { id: "lastfm", label, ok: false, hint: "Limite do Last.fm atingido. Tente em alguns minutos." };
    return { id: "lastfm", label, ok: false, hint: `O Last.fm respondeu ${res.status}. Tente de novo mais tarde.` };
  } catch {
    return { id: "lastfm", label, ok: false, hint: "Sem conexão com o Last.fm. Verifique a internet." };
  }
}

export async function runConfigTest(env: Env, fetchFn: Fetch = fetch): Promise<Check[]> {
  const present = envPresence(env);
  const checks: Check[] = REQUIRED_ENV.map((name: EnvName) => ({
    id: name,
    label: `${name} definida`,
    ok: present[name],
    ...(!present[name] && { hint: `Falta em .env.local. ${RESTART}` }),
  }));

  if (present.AUTH_URL) {
    const ok = env.AUTH_URL!.trim().replace(/\/$/, "") === LOCAL_URL;
    checks.push({
      id: "auth-url",
      label: `AUTH_URL é ${LOCAL_URL}`,
      ok,
      ...(!ok && { hint: `Use exatamente ${LOCAL_URL} (127.0.0.1, não localhost; porta 3000).` }),
    });
  }
  if (present.AUTH_SECRET) {
    const ok = env.AUTH_SECRET!.trim().length >= 32;
    checks.push({
      id: "auth-secret",
      label: "AUTH_SECRET tem pelo menos 32 caracteres",
      ok,
      ...(!ok && { hint: "Gere outro com o botão \"Gerar AUTH_SECRET\" ou npm run setup:env." }),
    });
  }

  const [spotify, lastfm] = await Promise.all([
    present.AUTH_SPOTIFY_ID && present.AUTH_SPOTIFY_SECRET ? checkSpotify(env, fetchFn) : null,
    present.LASTFM_API_KEY ? checkLastfm(env, fetchFn) : null,
  ]);
  if (spotify) checks.push(spotify);
  if (lastfm) checks.push(lastfm);
  return checks;
}
