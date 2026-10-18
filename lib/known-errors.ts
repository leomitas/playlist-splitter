// Common setup / API errors and how to fix them. The /setup page lists them all (anchor
// #erro-<id>); error messages in the app show the matching one with a link there.

import type { ApiError } from "@/lib/spotify";

export type KnownError = {
  id: string;
  title: string;
  // what the user sees
  symptom: string;
  fix: string;
};

export const KNOWN_ERRORS: KnownError[] = [
  {
    id: "redirect-uri",
    title: "Invalid redirect URI",
    symptom: "A página do Spotify mostra \"INVALID_CLIENT: Invalid redirect URI\" ao entrar.",
    fix: "No Dashboard, em Settings > Redirect URIs, cadastre exatamente http://127.0.0.1:3000/api/auth/callback/spotify e salve. AUTH_URL deve ser http://127.0.0.1:3000.",
  },
  {
    id: "user-not-registered",
    title: "403: usuário não cadastrado",
    symptom: "Depois do login, erro 403 em /me com \"the user may not be registered\".",
    fix: "Em Development Mode só entram contas cadastradas: Dashboard > seu app > User Management, adicione o nome e o e-mail da conta Spotify (até 5 usuários). Depois saia e entre de novo.",
  },
  {
    id: "quota",
    title: "429 / QUOTA_EXCEEDED",
    symptom: "Erro 429 com Retry-After longo (minutos ou horas) ou \"QUOTA_EXCEEDED\".",
    fix: "O Spotify bloqueou o app por excesso de chamadas. Não tente de novo: cada tentativa pode prolongar o bloqueio. O app mostra até quando e libera os botões sozinho. Prefira \"Sincronizar curtidas\" à reanálise completa.",
  },
  {
    id: "premium",
    title: "Premium vencido",
    symptom: "Erro 403 citando \"premium\" (ex.: \"Active premium subscription required for the owner of the app\").",
    fix: "Apps em Development Mode exigem que o dono do app tenha Spotify Premium ativo. Renove o Premium da conta que criou o app no Dashboard.",
  },
  {
    id: "localhost",
    title: "localhost em vez de 127.0.0.1",
    symptom: "O login volta para a tela inicial sem entrar, ou dá erro de redirect.",
    fix: "Abra sempre http://127.0.0.1:3000. O Spotify não aceita localhost como redirect URI e o cookie de sessão fica preso ao endereço usado.",
  },
  {
    id: "restart",
    title: "Servidor não reiniciado",
    symptom: "Você preencheu o .env.local mas o app continua dizendo que falta variável, ou o login dá \"Configuration\".",
    fix: "O Next.js só lê o .env.local ao iniciar. Pare o servidor (Ctrl+C) e rode npm run dev de novo. No Windows, confira se sobrou um processo na porta 3000.",
  },
];

const byId = new Map(KNOWN_ERRORS.map((e) => [e.id, e]));
export const knownError = (id: string) => byId.get(id)!;
export const setupHref = (e: KnownError) => `/setup#erro-${e.id}`;

// Matching entry for an API error, if any
export function matchApiError(e: Pick<ApiError, "status" | "raw" | "retryAfter" | "blockedUntil">): KnownError | null {
  const raw = e.raw ?? "";
  if (e.status === 429 && (e.blockedUntil || /QUOTA_EXCEEDED/i.test(raw) || (e.retryAfter ?? 0) > 120)) return knownError("quota");
  if (e.status === 403 && /premium/i.test(raw)) return knownError("premium");
  if (e.status === 403 && /not be registered|not registered|user management/i.test(raw)) return knownError("user-not-registered");
  return null;
}

// Auth.js error codes that reach the home page as ?error=...
export function matchAuthError(code: string): KnownError | null {
  if (code === "Configuration" || code === "MissingSecret") return knownError("restart");
  if (code === "AccessDenied") return knownError("user-not-registered");
  if (["OAuthCallbackError", "OAuthSignin", "OAuthCallback", "CallbackRouteError", "InvalidCheck"].includes(code))
    return knownError("redirect-uri");
  return null;
}
