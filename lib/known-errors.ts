// Common setup / API errors and how to fix them. The /setup page lists them all (anchor
// #erro-<id>); error messages in the app show the matching one with a link there.

import type { ApiError } from "@/lib/spotify";

// Title, symptom and fix of each one live in the dictionaries (knownError.<id>.*)
export const KNOWN_ERROR_IDS = ["redirect-uri", "user-not-registered", "quota", "premium", "localhost", "restart"] as const;
export type KnownErrorId = (typeof KNOWN_ERROR_IDS)[number];
export type KnownError = { id: KnownErrorId };

export const KNOWN_ERRORS: KnownError[] = KNOWN_ERROR_IDS.map((id) => ({ id }));

const byId = new Map(KNOWN_ERRORS.map((e) => [e.id, e]));
export const knownError = (id: KnownErrorId) => byId.get(id)!;
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
