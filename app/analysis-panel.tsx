"use client";

import { lastfm } from "@/lib/lastfm-client";
import { spotify } from "@/lib/spotify-client";
import { estimateRemainingMs, type Run } from "./analysis-queue";
import type { RowStatus } from "./playlist-picker";
import { RateLimitNotice } from "./rate-limit-notice";
import { RawError } from "./raw-error";

const fmt = (n: number) => n.toLocaleString("pt-BR");

export function formatEta(ms: number) {
  const min = Math.round(ms / 60000);
  return min < 1 ? "menos de 1 min restante" : `~${fmt(min)} min restantes`;
}

// "1.850 de 4.344" while reading, so long sources (liked songs) visibly progress
const progressText = (c: NonNullable<Run["current"]>) => `${fmt(c.done)}${c.total ? ` de ${fmt(c.total)}` : ""}`;

// Status line for one playlist of the run, shown next to it in the playlist list
export function itemStatus(run: Run, i: Run["items"][number]): RowStatus {
  const failures = i.status === "erro" && i.errorCount && i.errorCount > 1 ? ` (${fmt(i.errorCount)} falhas)` : "";
  const text =
    i.status === "analisando" && run.current
      ? `${run.current.step === "faixas" ? "lendo faixas" : "buscando gêneros"} ${progressText(run.current)}`
      : i.status === "concluída" && i.skipped?.length
        ? `concluída com ${fmt(i.skipped.length)} ${i.skipped.length === 1 ? "faixa pulada" : "faixas puladas"}`
        : i.status === "pendente"
          ? "na fila"
          : `${i.status}${failures}`;
  return { status: i.status, text };
}

const PHASE: Record<Run["phase"], string> = {
  running: "Analisando",
  paused: "Análise pausada",
  done: "Análise concluída",
  cancelled: "Análise cancelada",
};

const pillButton = "rounded-full border border-fio px-4 py-1.5 transition-colors hover:border-areia hover:bg-grafite-2";
const smallButton =
  "flex-none rounded-full border border-fio px-2.5 py-0.5 text-xs transition-colors hover:border-areia hover:bg-grafite-2";

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
  const total = run.items.length;
  const finished = run.items.filter((i) => i.status !== "pendente" && i.status !== "analisando").length;
  const failed = run.items.filter((i) => i.status === "erro");
  const active = run.phase === "running" || run.phase === "paused";
  const currentFraction = run.current?.total ? run.current.done / run.current.total : 0;
  const reading = run.items.find((i) => i.status === "analisando");
  const skipped = run.items.flatMap((i) => (i.skipped ?? []).map((s) => ({ ...s, source: i.name })));
  const untagged = run.items.flatMap((i) => (i.untagged ?? []).map((u) => ({ ...u, source: i.name })));
  const untaggedGroups = (["entrada inválida", "erro do Last.fm"] as const)
    .map((reason) => ({ reason, list: untagged.filter((u) => u.reason === reason) }))
    .filter((g) => g.list.length > 0);
  const percent = total === 0 ? 0 : Math.min(100, ((finished + (run.current ? currentFraction : 0)) / total) * 100);
  const eta = run.phase === "running" ? estimateRemainingMs(run) : null;
  // the big number: the playlist being read, or how many ended
  const position = active ? Math.min(finished + 1, total) : run.phase === "done" ? finished - failed.length : finished;
  const ofTotal = active
    ? `de ${fmt(total)}`
    : `de ${fmt(total)} ${run.phase === "done" ? "analisadas" : "processadas"}`;

  return (
    <section
      className="flex flex-none flex-col gap-3 rounded-xl border border-fio bg-grafite p-4 text-sm lg:max-h-[55%] lg:overflow-y-auto"
      aria-label="Análise"
    >
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-areia">{PHASE[run.phase]}</p>
          <p className="flex items-baseline gap-1.5">
            {active && <span className="text-areia">playlist</span>}
            <span className="num text-4xl">{fmt(position)}</span>
            <span className="text-areia">{ofTotal}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <p className="text-areia">faixas únicas</p>
          <p className="num text-4xl">{fmt(run.tracks.length)}</p>
        </div>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-cafe"
        role="progressbar"
        aria-label="Progresso da análise"
        aria-valuenow={Math.round(percent)}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${run.phase === "paused" ? "bg-areia" : "bg-papel"}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {(reading || eta !== null) && (
        <div className="flex flex-col gap-0.5 text-xs text-areia">
          {run.current && reading && (
            <p className="truncate">
              <span className="text-papel">{reading.name}</span>:{" "}
              {run.current.step === "faixas" ? "lendo faixas" : "buscando gêneros"} {progressText(run.current)}
            </p>
          )}
          {eta !== null && <p>{formatEta(eta)}</p>}
        </div>
      )}

      {/* only while analyzing; playlist creation shows its own notice */}
      {active && <RateLimitNotice queue={spotify} service="Spotify" />}
      {active && <RateLimitNotice queue={lastfm} service="Last.fm" />}

      {active && (
        <div className="flex gap-2">
          {run.phase === "running" ? (
            <button className={pillButton} onClick={onPause}>
              Pausar
            </button>
          ) : (
            <button
              className="rounded-full bg-papel px-4 py-1.5 font-bold text-cafe transition-opacity hover:opacity-90"
              onClick={onResume}
            >
              Retomar
            </button>
          )}
          <button
            className="rounded-full px-4 py-1.5 text-areia transition-colors hover:bg-grafite-2 hover:text-papel"
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      )}

      {failed.length > 0 && (
        <details className="rounded-lg border border-erro/40 bg-erro/10 p-2.5">
          <summary className="cursor-pointer font-bold text-erro">
            {fmt(failed.length)} de {fmt(total)} {failed.length === 1 ? "playlist com erro" : "playlists com erro"}
          </summary>
          <ul className="mt-2 flex flex-col gap-3">
            {failed.map((i) => (
              <li key={i.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-bold">{i.name}</span>
                  {i.errorCount && i.errorCount > 1 && (
                    <span className="text-xs text-erro">{fmt(i.errorCount)} falhas</span>
                  )}
                  <button className={smallButton} onClick={() => onReprocess(i.id)}>
                    Reprocessar
                  </button>
                </div>
                {i.error && <RawError error={i.error} />}
              </li>
            ))}
          </ul>
        </details>
      )}
      {skipped.length > 0 && (
        <details className="rounded-lg bg-alerta/10 p-2.5 text-xs">
          <summary className="cursor-pointer font-bold text-alerta">
            {fmt(skipped.length)} {skipped.length === 1 ? "faixa pulada" : "faixas puladas"} por erro do Spotify
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
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
        <details key={g.reason} className="rounded-lg bg-alerta/10 p-2.5 text-xs">
          <summary className="cursor-pointer font-bold text-alerta">
            {fmt(g.list.length)} {g.list.length === 1 ? "faixa sem tags" : "faixas sem tags"} por {g.reason}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {g.list.map((u, idx) => (
              <li key={idx}>
                {u.source}: {u.name || "(sem nome)"} de {u.artist || "(sem artista)"}{" "}
                <span className="text-areia">({u.detail})</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
