import Link from "next/link";
import { matchApiError, setupHref } from "@/lib/known-errors";
import type { ApiError } from "@/lib/spotify";

// Known cause and fix for an API error, with a link to /setup
export function ErrorHint({ error }: { error: ApiError }) {
  const known = matchApiError(error);
  if (!known) return null;
  return (
    <p className="mt-1.5 text-xs text-papel">
      <span className="font-bold">{known.title}:</span> {known.fix}{" "}
      <Link href={setupHref(known)} className="underline underline-offset-2">
        Ver em Configuração
      </Link>
    </p>
  );
}

export function RawError({ error }: { error: ApiError }) {
  return (
    <div className="rounded-md border border-erro/60 bg-erro/10 p-3 text-sm text-erro break-words">
      <p className="font-semibold">
        {error.method ?? "GET"} {error.url} → {error.status ?? "sem resposta"}
      </p>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{error.raw}</pre>
      <ErrorHint error={error} />
    </div>
  );
}
