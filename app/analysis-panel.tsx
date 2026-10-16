"use client";

import { useState } from "react";
import { lastfm } from "@/lib/lastfm-client";
import { spotify } from "@/lib/spotify-client";
import { estimateRemainingMs, type ItemStatus, type Run } from "./analysis-queue";
import { RateLimitNotice } from "./rate-limit-notice";
import { RawError } from "./raw-error";

const STATUS_STYLE: Record<ItemStatus, string> = {
  pendente: "text-gray-500",
  analisando: "text-blue-700",
  concluída: "text-green-700",
  erro: "text-red-700",
  cancelada: "text-gray-500",
};

const fmt = (n: number) => n.toLocaleString("pt-BR");

function formatEta(ms: number) {
  const min = Math.round(ms / 60000);
  return min < 1 ? "menos de 1 min restante" : `~${fmt(min)} min restantes`;
}

export function AnalysisPanel({
  run,
  onPause,
  onResume,
  onCancel,
  onReprocess,
}: {
  run: Run;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onReprocess: (id: string) => void;
}) {
  const [showList, setShowList] = useState(false);
  const total = run.items.length;
  const finished = run.items.filter((i) => i.status !== "pendente" && i.status !== "analisando").length;
  const failed = run.items.filter((i) => i.status === "erro").length;
  const active = run.phase === "running" || run.phase === "paused";
  const currentFraction = run.current?.total ? run.current.done / run.current.total : 0;
  const reading = run.items.find((i) => i.status === "analisando");
  const skipped = run.items.flatMap((i) => (i.skipped ?? []).map((s) => ({ ...s, source: i.name })));
  // "1.850 de 4.344" while reading, so long sources (liked songs) visibly progress
  const progressText = (c: NonNullable<Run["current"]>) =>
    `${fmt(c.done)}${c.total ? ` de ${fmt(c.total)}` : ""}`;
  const statusText = (i: Run["items"][number]) =>
    i.status === "analisando" && run.current
      ? `${run.current.step === "faixas" ? "lendo" : "gêneros"} ${progressText(run.current)}`
      : i.status === "concluída" && i.skipped?.length
        ? `concluída com ${fmt(i.skipped.length)} ${i.skipped.length === 1 ? "faixa pulada" : "faixas puladas"}`
        : i.status;
  const percent = total === 0 ? 0 : Math.min(100, ((finished + (run.current ? currentFraction : 0)) / total) * 100);
  const eta = run.phase === "running" ? estimateRemainingMs(run) : null;

  const head =
    run.phase === "done"
      ? `Análise concluída: ${fmt(finished - failed)} de ${fmt(total)} playlists`
      : run.phase === "cancelled"
        ? `Análise cancelada: ${fmt(finished)} de ${fmt(total)} playlists processadas`
        : `Playlist ${fmt(Math.min(finished + 1, total))} de ${fmt(total)}`;

  return (
    <section className="flex flex-col gap-2 rounded border p-3 text-sm">
      <p className="font-medium">
        {head} · {fmt(run.tracks.length)} faixas únicas
        {eta !== null && ` · ${formatEta(eta)}`}
        {run.phase === "paused" && " · pausada"}
      </p>
      <div className="h-2 w-full overflow-hidden rounded bg-gray-200" role="progressbar" aria-valuenow={Math.round(percent)}>
        <div className="h-full bg-green-600 transition-all" style={{ width: `${percent}%` }} />
      </div>
      {run.current && reading && (
        <p className="text-xs text-gray-600">
          {reading.name}: {run.current.step === "faixas" ? "lendo faixas" : "buscando gêneros"} {progressText(run.current)}
        </p>
      )}
      {skipped.length > 0 && (
        <details className="rounded bg-yellow-50 p-2 text-xs">
          <summary className="cursor-pointer font-medium text-yellow-900">
            {fmt(skipped.length)} {skipped.length === 1 ? "faixa pulada" : "faixas puladas"} por erro do Spotify
          </summary>
          <ul className="mt-1 flex max-h-60 flex-col gap-0.5 overflow-auto">
            {skipped.map((s) => (
              <li key={`${s.source}:${s.offset}`}>
                {s.source}: posição {fmt(s.offset + 1)}
                {s.after ? ` (depois de «${s.after}»)` : " (início da lista)"}
              </li>
            ))}
          </ul>
        </details>
      )}
      {failed > 0 && (
        <div className="flex flex-col gap-2 rounded bg-red-50 p-2">
          <p className="text-xs font-medium text-red-700">
            {fmt(failed)} de {fmt(total)} {failed === 1 ? "playlist com erro" : "playlists com erro"}
          </p>
          {run.items
            .filter((i) => i.status === "erro")
            .map((i) => (
              <div key={i.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
                  {i.errorCount && i.errorCount > 1 && (
                    <span className="text-xs text-red-700">{fmt(i.errorCount)} falhas</span>
                  )}
                  <button className="rounded border bg-white px-2 text-xs hover:bg-gray-100" onClick={() => onReprocess(i.id)}>
                    Reprocessar
                  </button>
                </div>
                {i.error && <RawError error={i.error} />}
              </div>
            ))}
        </div>
      )}

      <RateLimitNotice queue={spotify} service="Spotify" />
      <RateLimitNotice queue={lastfm} service="Last.fm" />

      {active && (
        <div className="flex gap-2">
          {run.phase === "running" ? (
            <button className="rounded border px-3 py-1 hover:bg-gray-100" onClick={onPause}>
              Pausar
            </button>
          ) : (
            <button className="rounded border bg-green-600 px-3 py-1 text-white hover:bg-green-700" onClick={onResume}>
              Retomar
            </button>
          )}
          <button className="rounded border px-3 py-1 hover:bg-gray-100" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      )}

      <button className="self-start text-xs underline" onClick={() => setShowList(!showList)}>
        {showList ? "Esconder" : "Mostrar"} status das playlists
      </button>
      {showList && (
        <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
          {run.items.map((i) => (
            <li key={i.id} className="flex flex-col border-t pt-1">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <span className={STATUS_STYLE[i.status]}>
                  {statusText(i)}
                  {i.status === "erro" && i.errorCount && i.errorCount > 1 && ` (${fmt(i.errorCount)} falhas)`}
                </span>
                {(i.status === "erro" || i.status === "cancelada") && (
                  <button className="rounded border px-2 text-xs hover:bg-gray-100" onClick={() => onReprocess(i.id)}>
                    Reprocessar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
