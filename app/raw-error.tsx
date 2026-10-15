import type { ApiError } from "@/lib/spotify";

export function RawError({ error }: { error: ApiError }) {
  return (
    <div className="rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-800 break-words">
      <p className="font-semibold">
        {error.method ?? "GET"} {error.url} → {error.status ?? "sem resposta"}
      </p>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{error.raw}</pre>
    </div>
  );
}
