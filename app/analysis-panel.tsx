"use client";

import { useState } from "react";
import { lastfm } from "@/lib/lastfm-client";
import { spotify } from "@/lib/spotify-client";
import { estimateRemainingMs, type ItemStatus, type Run } from "./analysis-queue";
import { RateLimitNotice } from "./rate-limit-notice";
import { RawError } from "./raw-error";

const STATUS_STYLE: Record<ItemStatus, string> = {
  pendente: "text-areia",
  analisando: "text-papel",
  concluída: "text-ok",
  erro: "text-erro",
  cancelada: "text-areia",
};

const fmt = (n: number) => n.toLocaleString("pt-BR");

export function formatEta(ms: number) {
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
  const untagged = run.items.flatMap((i) => (i.untagged ?? []).map((u) => ({ ...u, source: i.name })));
  const untaggedGroups = (["entrada inválida", "erro do Last.fm"] as const)
    .map((reason) => ({ reason, list: untagged.filter((u) => u.reason === reason) }))
    .filter((g) => g.list.length > 0);
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
    <section className="flex flex-col gap-3 rounded-xl border border-fio bg-grafite p-4 text-sm" aria-label="Análise">
      <p className="font-medium">
        {head} · {fmt(run.tracks.length)} faixas únicas
        {eta !== null && ` · ${formatEta(eta)}`}
        {run.phase === "paused" && " · pausada"}
      </p>
      <div className="h-2 w-full overflow-hidden rounded bg-cafe" role="progressbar" aria-valuenow={Math.round(percent)}>
        <div className="h-full bg-papel transition-all" style={{ width: `${percent}%` }} />
      </div>
      {run.current && reading && (
        <p className="text-xs text-areia">
          {reading.name}: {run.current.step === "faixas" ? "lendo faixas" : "buscando gêneros"} {progressText(run.current)}
        </p>
      )}
      {skipped.length > 0 && (
        <details className="rounded bg-alerta/10 p-2 text-xs">
          <summary className="cursor-pointer font-medium text-alerta">
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
      {untaggedGroups.map((g) => (
        <details key={g.reason} className="rounded bg-alerta/10 p-2 text-xs">
          <summary className="cursor-pointer font-medium text-alerta">
            {fmt(g.list.length)} {g.list.length === 1 ? "faixa sem tags" : "faixas sem tags"} por {g.reason}
          </summary>
          <ul className="mt-1 flex max-h-60 flex-col gap-0.5 overflow-auto">
            {g.list.map((u, idx) => (
              <li key={idx}>
                {u.source}: {u.name || "(sem nome)"} — {u.artist || "(sem artista)"}{" "}
                <span className="text-areia">({u.detail})</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {failed > 0 && (
        <div className="flex flex-col gap-2 rounded bg-erro/10 p-2">
          <p className="text-xs font-medium text-erro">
            {fmt(failed)} de {fmt(total)} {failed === 1 ? "playlist com erro" : "playlists com erro"}
          </p>
          {run.items
            .filter((i) => i.status === "erro")
            .map((i) => (
              <div key={i.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
                  {i.errorCount && i.errorCount > 1 && (
                    <span className="text-xs text-erro">{fmt(i.errorCount)} falhas</span>
                  )}
                  <button className="rounded-full border border-fio bg-transparent px-2 text-xs hover:bg-grafite-2" onClick={() => onReprocess(i.id)}>
                    Reprocessar
                  </button>
                </div>
                {i.error && <RawError error={i.error} />}
              </div>
            ))}
        </div>
      )}

      {/* only while analyzing; playlist creation shows its own notice */}
      {active && <RateLimitNotice queue={spotify} service="Spotify" />}
      {active && <RateLimitNotice queue={lastfm} service="Last.fm" />}

      {active && (
        <div className="flex gap-2">
          {run.phase === "running" ? (
            <button className="rounded-full border border-fio px-3 py-1 hover:bg-grafite-2" onClick={onPause}>
              Pausar
            </button>
          ) : (
            <button className="rounded-full border border-fio bg-papel px-3 py-1 font-bold text-cafe hover:opacity-90" onClick={onResume}>
              Retomar
            </button>
          )}
          <button className="rounded-full border border-fio px-3 py-1 hover:bg-grafite-2" onClick={onCancel}>
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
            <li key={i.id} className="flex flex-col border-t border-fio pt-1">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <span className={STATUS_STYLE[i.status]}>
                  {statusText(i)}
                  {i.status === "erro" && i.errorCount && i.errorCount > 1 && ` (${fmt(i.errorCount)} falhas)`}
                </span>
                {(i.status === "erro" || i.status === "cancelada") && (
                  <button className="rounded-full border border-fio px-2 text-xs hover:bg-grafite-2" onClick={() => onReprocess(i.id)}>
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
