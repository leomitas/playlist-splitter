"use client";

import { CLASSIFIER_VERSION } from "@/lib/classify";
import { lastfm } from "@/lib/lastfm-client";
import { LIKED_ID } from "@/lib/spotify";
import { spotify } from "@/lib/spotify-client";
import { estimateRemainingMs, type LikedSync, type Run } from "./analysis-queue";
import { countryEtaMs, countryLookup, musicbrainz, type CountryState } from "./country-lookup";
import { useI18n, type I18n } from "./i18n";
import type { RowStatus } from "./playlist-picker";
import { RateLimitNotice } from "./rate-limit-notice";
import { RawError } from "./raw-error";

export function formatEta({ t }: I18n, ms: number) {
  const min = Math.round(ms / 60000);
  return min < 1 ? t("eta.underMinute") : t("eta.minutes", { count: min });
}

// liked songs are stored under a fixed name; they're shown in the current language
export const sourceName = ({ t }: I18n, item: { id: string; name: string }) =>
  item.id === LIKED_ID ? t("liked.name") : item.name;

// "1.850 de 4.344" while reading, so long sources (liked songs) visibly progress
const progressText = ({ t, n }: I18n, c: NonNullable<Run["current"]>) =>
  c.total ? t("progress.of", { done: c.done, total: c.total }) : n(c.done);

const stepText = ({ t }: I18n, c: NonNullable<Run["current"]>) =>
  c.step === "faixas" ? t("progress.readingTracks") : t("progress.fetchingGenres");

// Status line for one playlist of the run, shown next to it in the playlist list
export function itemStatus(i18n: I18n, run: Run, i: Run["items"][number]): RowStatus {
  const { t } = i18n;
  const failures = i.status === "erro" && i.errorCount && i.errorCount > 1 ? ` ${t("itemStatus.failures", { count: i.errorCount })}` : "";
  const text =
    i.status === "analisando" && run.current
      ? `${stepText(i18n, run.current)} ${progressText(i18n, run.current)}`
      : i.status === "concluída" && i.skipped?.length
        ? t("itemStatus.doneSkipped", { count: i.skipped.length })
        : i.status === "pendente"
          ? t("itemStatus.queued")
          : `${t(`itemStatus.${i.status}`)}${failures}`;
  return { status: i.status, text };
}

const PHASE = {
  running: "phase.running",
  paused: "phase.paused",
  done: "phase.done",
  cancelled: "phase.cancelled",
} as const satisfies Record<Run["phase"], string>;

const pillButton =
  "rounded-full border border-fio px-4 py-1.5 transition-colors hover:border-areia hover:bg-grafite-2 disabled:cursor-not-allowed disabled:opacity-40";
const smallButton =
  "flex-none rounded-full border border-fio px-2.5 py-0.5 text-xs transition-colors hover:border-areia hover:bg-grafite-2 disabled:cursor-not-allowed disabled:opacity-40";

function syncText({ t }: I18n, s: LikedSync | undefined) {
  if (!s) return t("sync.idle");
  if (s.state === "lendo") return t("sync.reading", { count: s.fresh });
  if (s.state === "gêneros") return t("sync.genres", { done: s.done, total: s.total });
  if (s.state === "concluída") return s.added === 0 ? t("sync.none") : t("sync.added", { count: s.added });
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
  const i18n = useI18n();
  const { t, n, rich } = i18n;
  const total = run.items.length;
  const finished = run.items.filter((i) => i.status !== "pendente" && i.status !== "analisando").length;
  const failed = run.items.filter((i) => i.status === "erro");
  const active = run.phase === "running" || run.phase === "paused";
  const currentFraction = run.current?.total ? run.current.done / run.current.total : 0;
  const reading = run.items.find((i) => i.status === "analisando");
  const skipped = run.items.flatMap((i) => (i.skipped ?? []).map((s) => ({ ...s, source: sourceName(i18n, i) })));
  const untagged = run.items.flatMap((i) => (i.untagged ?? []).map((u) => ({ ...u, source: sourceName(i18n, i) })));
  const untaggedGroups = (["entrada inválida", "erro do Last.fm"] as const)
    .map((reason) => ({ reason, list: untagged.filter((u) => u.reason === reason) }))
    .filter((g) => g.list.length > 0);
  const percent = total === 0 ? 0 : Math.min(100, ((finished + (run.current ? currentFraction : 0)) / total) * 100);
  const eta = run.phase === "running" ? estimateRemainingMs(run) : null;
  // the big number: the playlist being read, or how many ended
  const position = active ? Math.min(finished + 1, total) : run.phase === "done" ? finished - failed.length : finished;
  const ofTotal = active
    ? t("analysis.of", { total })
    : run.phase === "done"
      ? t("analysis.ofAnalyzed", { total })
      : t("analysis.ofProcessed", { total });
  const liked = run.items.find((i) => i.id === LIKED_ID);
  const syncing = run.sync?.state === "lendo" || run.sync?.state === "gêneros";
  const syncLine = syncText(i18n, run.sync);

  // desktop sidebar: 21rem ~ its title, the picker controls, the button and the gaps; the panel takes
  // at most half of the rest (scrolling inside), the playlist list gets the remainder
  return (
    <section
      className="flex flex-none flex-col gap-3 rounded-xl border border-fio bg-grafite p-4 text-sm lg:max-h-[max(6rem,calc((100%-21rem)/2))] lg:overflow-y-auto"
      aria-label={t("analysis.label")}
    >
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-areia">{t(PHASE[run.phase])}</p>
          <p className="flex items-baseline gap-1.5">
            {active && <span className="text-areia">{t("analysis.playlist")}</span>}
            <span className="num text-4xl">{n(position)}</span>
            <span className="text-areia">{ofTotal}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <p className="text-areia">{t("analysis.uniqueTracks")}</p>
          <p className="num text-4xl">{n(run.tracks.length)}</p>
        </div>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-cafe"
        role="progressbar"
        aria-label={t("analysis.progress")}
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
              <span className="text-papel">{sourceName(i18n, reading)}</span>: {stepText(i18n, run.current)}{" "}
              {progressText(i18n, run.current)}
            </p>
          )}
          {eta !== null && <p>{formatEta(i18n, eta)}</p>}
        </div>
      )}

      {/* only while analyzing; playlist creation shows its own notice */}
      {(active || syncing) && <RateLimitNotice queue={spotify} service="Spotify" />}
      {(active || syncing) && <RateLimitNotice queue={lastfm} service="Last.fm" />}

      {active && (
        <div className="flex gap-2">
          {run.phase === "running" ? (
            <button className={pillButton} onClick={onPause}>
              {t("common.pause")}
            </button>
          ) : (
            <button
              className="rounded-full bg-papel px-4 py-1.5 font-bold text-cafe transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!!blockedReason}
              title={blockedReason}
              onClick={onResume}
            >
              {blockedReason ? t("analysis.resumeBlocked") : t("common.resume")}
            </button>
          )}
          <button
            className="rounded-full px-4 py-1.5 text-areia transition-colors hover:bg-grafite-2 hover:text-papel"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
        </div>
      )}

      {countryArtists.size > 0 && !active && <CountryProgress state={countries} artists={countryArtists} />}

      {!active && (run.rulesVersion ?? 1) < CLASSIFIER_VERSION && (
        <p className="rounded-lg border border-alerta/50 bg-alerta/10 p-2.5 text-xs">
          {rich("analysis.rulesChanged", undefined, { b: (c) => <span className="font-bold text-alerta">{c}</span> })}
        </p>
      )}

      {liked && !active && (
        <div className="flex flex-col gap-1.5 border-t border-fio pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              className={pillButton}
              disabled={!!blockedReason || syncing || liked.status !== "concluída"}
              title={blockedReason ?? (liked.status !== "concluída" ? t("sync.needAnalyzed") : undefined)}
              onClick={onSyncLiked}
            >
              {syncing ? t("sync.syncing") : t("sync.button")}
            </button>
            <button
              className="text-xs text-areia underline-offset-4 transition-colors hover:text-papel hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
              disabled={!!blockedReason || syncing}
              title={blockedReason ?? t("sync.fullTitle")}
              onClick={onFullReanalyze}
            >
              {t("sync.full")}
            </button>
          </div>
          {syncLine && <p className="text-xs text-areia">{syncLine}</p>}
          {run.sync?.state === "erro" && <RawError error={run.sync.error} />}
        </div>
      )}

      {failed.length > 0 && (
        <details className="rounded-lg border border-erro/40 bg-erro/10 p-2.5">
          <summary className="cursor-pointer font-bold text-erro">{t("analysis.failed", { count: failed.length, total })}</summary>
          <ul className="mt-2 flex flex-col gap-3">
            {failed.map((i) => (
              <li key={i.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-bold">{sourceName(i18n, i)}</span>
                  {i.errorCount && i.errorCount > 1 && (
                    <span className="text-xs text-erro">{t("analysis.failures", { count: i.errorCount })}</span>
                  )}
                  <button
                    className={smallButton}
                    disabled={!!blockedReason}
                    title={blockedReason}
                    onClick={() => onReprocess(i.id)}
                  >
                    {t("common.reprocess")}
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
          <summary className="cursor-pointer font-bold text-alerta">{t("analysis.skipped", { count: skipped.length })}</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {skipped.map((s) => (
              <li key={`${s.source}:${s.offset}`}>
                {t("analysis.skippedAt", { source: s.source, position: s.offset + 1 })}{" "}
                {s.after ? t("analysis.skippedAfter", { track: s.after }) : t("analysis.skippedStart")}
              </li>
            ))}
          </ul>
        </details>
      )}
      {untaggedGroups.map((g) => (
        <details key={g.reason} className="rounded-lg bg-alerta/10 p-2.5 text-xs">
          <summary className="cursor-pointer font-bold text-alerta">
            {t("analysis.untagged", { count: g.list.length, reason: t(`untaggedReason.${g.reason}`) })}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {g.list.map((u, idx) => (
              <li key={idx}>
                {t("analysis.untaggedItem", {
                  source: u.source,
                  name: u.name || t("common.noName"),
                  artist: u.artist || t("common.noArtist"),
                })}{" "}
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
  const i18n = useI18n();
  const { t } = i18n;
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
        <p className="font-bold text-papel">{t("country.title")}</p>
        {running && (
          <button
            className="flex-none rounded-full border border-fio px-2.5 py-0.5 transition-colors hover:border-areia hover:bg-grafite-2"
            onClick={state.phase === "paused" ? countryLookup.resume : countryLookup.pause}
          >
            {state.phase === "paused" ? t("common.resume") : t("common.pause")}
          </button>
        )}
      </div>
      <p className="text-areia lg:[@media(max-height:56rem)]:hidden">{t("country.body", { count: artists.size })}</p>
      {running && (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-cafe" aria-hidden>
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${state.phase === "paused" ? "bg-areia" : "bg-papel"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-areia" aria-live="polite">
            {t(state.phase === "paused" ? "country.paused" : "country.running", { done: state.done, total: state.total })}
            {state.phase === "running" && ` · ${formatEta(i18n, countryEtaMs(state))}`}
          </p>
          <RateLimitNotice queue={musicbrainz} service="MusicBrainz" />
        </>
      )}
      <p className="text-areia">
        {t("country.summary", { br, abroad, unknown })}
        {pending > 0 && !running && ` ${t("country.queued", { count: pending })}`}
        {unknown > 0 && ` ${t("country.uncertainNote")}`}
      </p>
      {state.failed > 0 && <p className="text-alerta">{t("country.failed", { count: state.failed })}</p>}
      {state.error?.status === 401 && <RawError error={state.error} />}
    </div>
  );
}
