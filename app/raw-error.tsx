import type { ApiError } from "@/lib/spotify";

export function RawError({ error }: { error: ApiError }) {
  return (
    <div className="rounded-md border border-erro/60 bg-erro/10 p-3 text-sm text-erro break-words">
      <p className="font-semibold">
        {error.method ?? "GET"} {error.url} → {error.status ?? "sem resposta"}
      </p>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{error.raw}</pre>
    </div>
  );
}
