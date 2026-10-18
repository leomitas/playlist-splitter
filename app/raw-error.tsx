"use client";

import Link from "next/link";
import { matchApiError, setupHref } from "@/lib/known-errors";
import type { ApiError } from "@/lib/spotify";
import { useI18n } from "./i18n";

// Known cause and fix for an API error, with a link to /setup
export function ErrorHint({ error }: { error: ApiError }) {
  const { t } = useI18n();
  const known = matchApiError(error);
  if (!known) return null;
  return (
    <p className="mt-1.5 text-xs text-papel">
      <span className="font-bold">{t(`knownError.${known.id}.title`)}:</span> {t(`knownError.${known.id}.fix`)}{" "}
      <Link href={setupHref(known)} className="underline underline-offset-2">
        {t("common.seeInSetup")}
      </Link>
    </p>
  );
}

// "GET /me → 401" and the body; errors the app produced show their translated message instead
export function ErrorBody({ error, method, className = "" }: { error: ApiError; method: string; className?: string }) {
  const { t, appError } = useI18n();
  const message = appError(error);
  return (
    <>
      <p className="font-semibold">
        {error.method ?? method} {error.url} → {error.status ?? t("error.noResponse")}
      </p>
      {message ? <p className={className}>{message}</p> : <pre className={`overflow-auto whitespace-pre-wrap ${className}`}>{error.raw}</pre>}
      <ErrorHint error={error} />
    </>
  );
}

export function RawError({ error }: { error: ApiError }) {
  return (
    <div className="rounded-md border border-erro/60 bg-erro/10 p-3 text-sm text-erro break-words">
      <ErrorBody error={error} method="GET" className="mt-1 max-h-60 text-xs" />
    </div>
  );
}
