"use client";

import { CLASSIFIER_VERSION } from "@/lib/classify";
import { lastfm } from "@/lib/lastfm-client";
import { LIKED_ID } from "@/lib/spotify";
import { spotify } from "@/lib/spotify-client";
import { estimateRemainingMs, type LikedSync, type Run } from "./analysis-queue";
import { countryEtaMs, countryLookup, musicbrainz, type CountryState } from "./country-lookup";
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

const pillButton =
  "rounded-full border border-fio px-4 py-1.5 transition-colors hover:border-areia hover:bg-grafite-2 disabled:cursor-not-allowed disabled:opacity-40";
const smallButton =
  "flex-none rounded-full border border-fio px-2.5 py-0.5 text-xs transition-colors hover:border-areia hover:bg-grafite-2 disabled:cursor-not-allowed disabled:opacity-40";

function syncText(s: LikedSync | undefined) {
  if (!s) return "Lê só as curtidas adicionadas desde a última leitura. Descurtidas só saem na reanálise completa.";
  if (s.state === "lendo") return `Lendo curtidas novas… ${fmt(s.fresh)}`;
  if (s.state === "gêneros") return `Buscando gêneros ${fmt(s.done)} de ${fmt(s.total)}`;
  if (s.state === "concluída")
    return s.added === 0 ? "Nenhuma curtida nova." : `${fmt(s.added)} ${s.added === 1 ? "curtida nova adicionada" : "curtidas novas adicionadas"}.`;
  return null;
}

export function AnalysisPanel({
  run,
  blockedReason,
  onPause,
  onResume,
  onCancel,
  onReprocess,
  onSyncLiked,
  onFullReanalyze,
  countries,
  countryArtists,
}: {
  run: Run;
  // set while Spotify blocks the app: every button that calls it is disabled with this reason
  blockedReason?: string;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onReprocess: (id: string) => void;
  onSyncLiked: () => void;
  onFullReanalyze: () => void;
  countries: CountryState;
  // artists whose family waits for their country (key -> name)
  countryArtists: Map<string, string>;
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
  const liked = run.items.find((i) => i.id === LIKED_ID);
  const syncing = run.sync?.state === "lendo" || run.sync?.state === "gêneros";

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
      {(active || syncing) && <RateLimitNotice queue={spotify} service="Spotify" />}
      {(active || syncing) && <RateLimitNotice queue={lastfm} service="Last.fm" />}

      {active && (
        <div className="flex gap-2">
          {run.phase === "running" ? (
            <button className={pillButton} onClick={onPause}>
              Pausar
            </button>
          ) : (
            <button
              className="rounded-full bg-papel px-4 py-1.5 font-bold text-cafe transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!!blockedReason}
              title={blockedReason}
              onClick={onResume}
            >
              {blockedReason ? "Retomar (bloqueado)" : "Retomar"}
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

      {countryArtists.size > 0 && !active && <CountryProgress state={countries} artists={countryArtists} />}

      {!active && (run.rulesVersion ?? 1) < CLASSIFIER_VERSION && (
        <p className="rounded-lg border border-alerta/50 bg-alerta/10 p-2.5 text-xs">
          <span className="font-bold text-alerta">As regras de gênero mudaram desde esta análise</span> (Funk BR e funk
          gringo). Analise as mesmas playlists de novo para aplicar: as tags vêm do cache do Last.fm e as
          faixas só são lidas de novo no Spotify se a playlist mudou.
        </p>
      )}

      {liked && !active && (
        <div className="flex flex-col gap-1.5 border-t border-fio pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              className={pillButton}
              disabled={!!blockedReason || syncing || liked.status !== "concluída"}
              title={blockedReason ?? (liked.status !== "concluída" ? "As curtidas precisam ter sido analisadas" : undefined)}
              onClick={onSyncLiked}
            >
              {syncing ? "Sincronizando…" : "Sincronizar curtidas"}
            </button>
            <button
              className="text-xs text-areia underline-offset-4 transition-colors hover:text-papel hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
              disabled={!!blockedReason || syncing}
              title={blockedReason ?? "Lê todas as faixas de novo, sem usar o cache das curtidas"}
              onClick={onFullReanalyze}
            >
              Reanálise completa
            </button>
          </div>
          {syncText(run.sync) && <p className="text-xs text-areia">{syncText(run.sync)}</p>}
          {run.sync?.state === "erro" && <RawError error={run.sync.error} />}
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
                  <button
                    className={smallButton}
                    disabled={!!blockedReason}
                    title={blockedReason}
                    onClick={() => onReprocess(i.id)}
                  >
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

// MusicBrainz country lookups for artists tagged only "funk": progress, time left, pause
function CountryProgress({ state, artists }: { state: CountryState; artists: Map<string, string> }) {
  let br = 0;
  let abroad = 0;
  let unknown = 0;
  let pending = 0;
  for (const key of artists.keys()) {
    const c = state.countries[key];
    if (c === undefined) pending++;
    else if (c === null) unknown++;
    else if (c === "BR") br++;
    else abroad++;
  }
  const running = state.phase === "running" || state.phase === "paused";
  const percent = state.total === 0 ? 0 : Math.min(100, (state.done / state.total) * 100);

  return (
    <div className="flex flex-col gap-1.5 border-t border-fio pt-3 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold text-papel">País dos artistas (MusicBrainz)</p>
        {running && (
          <button
            className="flex-none rounded-full border border-fio px-2.5 py-0.5 transition-colors hover:border-areia hover:bg-grafite-2"
            onClick={state.phase === "paused" ? countryLookup.resume : countryLookup.pause}
          >
            {state.phase === "paused" ? "Retomar" : "Pausar"}
          </button>
        )}
      </div>
      <p className="text-areia">
        Decide a tag genérica &quot;funk&quot; de {fmt(artists.size)} {artists.size === 1 ? "artista" : "artistas"}: Brasil vai
        para Funk BR, outro país para R&amp;B/Soul. Uma consulta por segundo.
      </p>
      {running && (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-cafe" aria-hidden>
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${state.phase === "paused" ? "bg-areia" : "bg-papel"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-areia" aria-live="polite">
            {state.phase === "paused" ? "Pausado" : "Consultando"} {fmt(state.done)} de {fmt(state.total)}
            {state.phase === "running" && ` · ${formatEta(countryEtaMs(state))}`}
          </p>
          <RateLimitNotice queue={musicbrainz} service="MusicBrainz" />
        </>
      )}
      <p className="text-areia">
        {fmt(br)} do Brasil · {fmt(abroad)} de outro país · {fmt(unknown)} não encontrados
        {pending > 0 && !running && ` · ${fmt(pending)} na fila`}
        {unknown > 0 && " (ficam em Funk (incerto) para revisão)"}
      </p>
      {state.failed > 0 && <p className="text-alerta">{fmt(state.failed)} consultas falharam; serão repetidas da próxima vez.</p>}
      {state.error?.status === 401 && <RawError error={state.error} />}
    </div>
  );
}
