"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ClassifiedTrack } from "@/lib/classify";
import { createWarnings, type CreateWarnings } from "@/lib/create-warnings";
import { chunk, findSplitterPlaylists, missingUris, planPlaylists, TRACK_URI, type PlannedPlaylist } from "@/lib/playlist-plan";
import type { Group } from "@/lib/preview-state";
import type { ApiError, ApiResult, Me } from "@/lib/spotify";
import { spotify } from "@/lib/spotify-client";
import { addTracks, createPlaylist } from "./actions";
import { formatEta } from "./analysis-panel";
import { genreColor } from "./genre-colors";
import { useI18n } from "./i18n";
import { RateLimitNotice } from "./rate-limit-notice";
import { ErrorBody } from "./raw-error";
import { loadCreatedUris, loadMe, loadPlaylists, rememberCreated, type CreatedPlaylist } from "./spotify-data";

type Mode = "update" | "create";

type Progress = {
  status:
    | "aguardando"
    | "criando"
    | "adicionando"
    | "criada"
    | "atualizada"
    | "nada novo"
    | "erro"
    | "não criada";
  batch?: number;
  totalBatches?: number;
  added: number;
  // tracks this playlist will receive
  total: number;
  url?: string;
  // set once Spotify confirmed the creation; a retry adds to it instead of creating another
  playlistId?: string;
  error?: ApiError;
};

type Job = { p: PlannedPlaylist; match: ExistingMatch | null; uris: string[] };

// Write calls a job still needs: create (unless the playlist exists) + the unconfirmed batches
const callsFor = (j: Job, from: Progress | undefined) =>
  j.uris.length === 0
    ? 0
    : ((from?.playlistId ?? j.match) ? 0 : 1) + chunk(j.uris.slice(from?.added ?? 0)).length;

// Write calls (create + add batches) across the whole run, for the global bar and the ETA
type CallStats = { done: number; total: number; etaMs: number | null };
type Clock = { total: number; done: number; doneAtStart: number; startedAt: number };

// ETA from the average time per write call since the run (or retry) started, waits included
function readClock(c: Clock): CallStats {
  const since = c.done - c.doneAtStart;
  return { done: c.done, total: c.total, etaMs: since === 0 ? null : ((Date.now() - c.startedAt) / since) * (c.total - c.done) };
}

function restartClock(c: Clock) {
  c.doneAtStart = c.done;
  c.startedAt = Date.now();
}

type ExistingMatch = {
  playlistId: string;
  url: string;
  newUris: string[];
  // how many of the user's playlists matched; only the first is used
  matches: number;
  // the playlist as it is now, so later batches keep its cache entry current
  current: CreatedPlaylist;
};

// Read-only: looks for playlists this app created earlier with the same name. Uses the session's
// playlist list (patched after every write) and the created-playlist cache, so nothing is read
// again unless a playlist's snapshot changed.
async function findExisting(
  planned: PlannedPlaylist[],
): Promise<ApiResult<{ me: Me; found: Record<string, ExistingMatch | null> }>> {
  const me = await loadMe();
  if (!me.ok) return me;
  const playlists = await loadPlaylists();
  if (!playlists.ok) return playlists;

  const result: Record<string, ExistingMatch | null> = {};
  for (const p of planned) {
    const found = findSplitterPlaylists(playlists.data, me.data.id, p.name);
    if (found.length === 0) {
      result[p.groupId] = null;
      continue;
    }
    const existing = await loadCreatedUris(found[0], me.data);
    if (!existing.ok) return existing;
    result[p.groupId] = {
      playlistId: found[0].id,
      url: `https://open.spotify.com/playlist/${found[0].id}`,
      newUris: missingUris(
        p.uris.filter((u) => TRACK_URI.test(u)),
        existing.data,
      ),
      matches: found.length,
      current: { id: found[0].id, name: found[0].name, snapshotId: found[0].snapshot_id, uris: existing.data },
    };
  }
  return { ok: true, data: { me: me.data, found: result } };
}

function RawError({ error }: { error: ApiError }) {
  return (
    <div className="mt-1 text-xs text-erro">
      <ErrorBody error={error} method="POST" className="max-h-40" />
    </div>
  );
}

// Memoized: gets the deferred groups, so it re-renders after the click has painted
export const CreatePlaylists = memo(function CreatePlaylists({
  groups,
  tracks,
  disabledReason,
  onDone,
}: {
  groups: Group[];
  tracks: Map<string, ClassifiedTrack>;
  disabledReason?: string;
  onDone: () => void;
}) {
  const i18n = useI18n();
  const { t, n, rich, genre, list } = i18n;
  const [phase, setPhase] = useState<"idle" | "checking" | "confirm" | "running" | "done">("idle");
  const [plan, setPlan] = useState<PlannedPlaylist[]>([]);
  const [existing, setExisting] = useState<Record<string, ExistingMatch | null>>({});
  const [checkError, setCheckError] = useState<ApiError | null>(null);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [isPublic, setIsPublic] = useState(false);
  // warnings computed when the confirmation opens; "Outros"/"Funk (incerto)" need an extra yes
  const [warnings, setWarnings] = useState<CreateWarnings>({ lowConfidence: [], uncertain: [] });
  const [uncertainOk, setUncertainOk] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  // group ids in execution order, and the index of the one being processed
  const [order, setOrder] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [calls, setCalls] = useState<CallStats>({ done: 0, total: 0, etaMs: null });
  // the dialog can be hidden while running or done; the footer then shows the progress
  const [sheetOpen, setSheetOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  // state updates are async; the ref blocks a second click landing before re-render
  const running = useRef(false);
  const jobs = useRef<Job[]>([]);
  const stats = useRef<Clock>({ total: 0, done: 0, doneAtStart: 0, startedAt: 0 });
  // owner for the playlist-list patch, and each group's playlist as Spotify last confirmed it
  const owner = useRef<Me | null>(null);
  const records = useRef(new Map<string, CreatedPlaylist>());
  // what the action bar announces: playlists with at least one valid track, and their tracks
  const outline = useMemo(() => {
    const planned = planPlaylists(groups, tracks).filter((p) => p.uris.length > 0);
    return { playlists: planned.length, tracks: planned.reduce((sum, p) => sum + p.uris.length, 0) };
  }, [groups, tracks]);
  // a group still named after its family shows (and gets created with) the translated name
  const shownName = (groupId: string, name: string) => (name === groupId ? genre(groupId) : name);

  const update = (groupId: string, p: Partial<Progress>) =>
    setProgress((prev) => ({ ...prev, [groupId]: { ...prev[groupId], ...p } }));

  const publish = () => setCalls(readClock(stats.current));

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (sheetOpen && !d.open) {
      d.showModal();
      // focus the dialog itself (announces its title), not the first scrollable area
      d.focus();
    }
    if (!sheetOpen && d.open) d.close();
  }, [sheetOpen, phase]);

  // closing the confirmation cancels it; the check can't be interrupted; progress just hides
  function closeSheet() {
    if (phase === "checking") return;
    if (phase === "confirm") setPhase("idle");
    setSheetOpen(false);
  }

  async function openConfirm() {
    const planned = planPlaylists(groups, tracks, genre);
    setPlan(planned);
    const w = createWarnings(groups, tracks);
    setWarnings({
      lowConfidence: w.lowConfidence.map((x) => ({ ...x, name: shownName(x.groupId, x.name) })),
      uncertain: w.uncertain.map((x) => ({ ...x, name: shownName(x.groupId, x.name) })),
    });
    setUncertainOk(false);
    setPhase("checking");
    setSheetOpen(true);
    const r = await findExisting(planned);
    const found = r.ok ? r.data.found : {};
    if (r.ok) owner.current = r.data.me;
    setCheckError(r.ok ? null : r);
    setExisting(found);
    setModes(Object.fromEntries(planned.map((p) => [p.groupId, found[p.groupId] ? "update" : "create"])));
    setPhase("confirm");
  }

  // keeps the created-playlist cache and the session's playlist list in step with Spotify
  async function remember(groupId: string, record: CreatedPlaylist) {
    records.current.set(groupId, record);
    if (owner.current) await rememberCreated(record, owner.current);
  }

  async function addInBatches(groupId: string, playlistId: string, uris: string[], alreadyAdded: number, onCall: () => void) {
    const batches = chunk(uris);
    let added = alreadyAdded;
    for (let i = 0; i < batches.length; i++) {
      update(groupId, { status: "adicionando", batch: i + 1, totalBatches: batches.length });
      const r = await spotify.call(() => addTracks(playlistId, batches[i]), `/playlists/${playlistId}/items`);
      if (!r.ok) return { added, error: r };
      added += batches[i].length;
      onCall();
      update(groupId, { added });
      const record = records.current.get(groupId);
      if (record) await remember(groupId, { ...record, snapshotId: r.data.snapshot_id, uris: [...record.uris, ...batches[i]] });
    }
    return { added, error: undefined };
  }

  // Statuses only move forward on API answers: "concluída" means Spotify confirmed every batch.
  // A retry continues where the job stopped: it reuses the playlist already created and only
  // sends the batches that weren't confirmed.
  async function processJob({ p, match, uris }: Job, from: Progress | undefined) {
    const s = stats.current;
    const before = s.done;
    const planned = callsFor({ p, match, uris }, from);
    const onCall = () => {
      s.done++;
      publish();
    };
    // calls a failed playlist won't make anymore leave the total, so the bar still reaches the end
    const settle = () => {
      s.total -= planned - (s.done - before);
      publish();
    };

    if (match) update(p.groupId, { url: match.url });
    if (uris.length === 0) {
      update(p.groupId, { status: match ? "nada novo" : "não criada" });
      return;
    }

    let playlistId = from?.playlistId ?? match?.playlistId;
    if (match && !records.current.has(p.groupId)) records.current.set(p.groupId, match.current);
    if (!playlistId) {
      update(p.groupId, { status: "criando" });
      const created = await spotify.call(() => createPlaylist(p.name, isPublic), "/me/playlists");
      if (!created.ok) {
        update(p.groupId, { status: "erro", error: created });
        settle();
        return;
      }
      onCall();
      playlistId = created.data.id;
      update(p.groupId, { url: created.data.url, playlistId });
      await remember(p.groupId, { id: playlistId, name: created.data.name, snapshotId: created.data.snapshot_id, uris: [] });
    }
    const already = from?.added ?? 0;
    const { added, error } = await addInBatches(p.groupId, playlistId, uris.slice(already), already, onCall);
    update(p.groupId, error ? { status: "erro", error, added } : { status: match ? "atualizada" : "criada", added });
    settle();
  }

  function finish() {
    // stays in the summary (never back to idle) so the same playlists aren't created twice by accident
    setPhase("done");
    running.current = false;
    // the session's playlist list was patched along the way; no new listing
    onDone();
  }

  async function run() {
    if (running.current) return;
    running.current = true;

    // Smallest first, so the first playlists are ready quickly. Uses the existing-playlist
    // lookup made when the confirmation opened; the playlist list isn't fetched again.
    const list: Job[] = plan
      .map((p) => {
        const match = modes[p.groupId] === "update" ? (existing[p.groupId] ?? null) : null;
        return { p, match, uris: match ? match.newUris : p.uris };
      })
      .sort((a, b) => a.uris.length - b.uris.length);
    jobs.current = list;
    stats.current = { total: list.reduce((n, j) => n + callsFor(j, undefined), 0), done: 0, doneAtStart: 0, startedAt: 0 };
    restartClock(stats.current);

    setOrder(list.map((j) => j.p.groupId));
    setCurrent(0);
    setCalls({ done: 0, total: stats.current.total, etaMs: null });
    setProgress(
      Object.fromEntries(list.map((j) => [j.p.groupId, { status: "aguardando", added: 0, total: j.uris.length } as Progress])),
    );
    setPhase("running");

    for (const [i, job] of list.entries()) {
      setCurrent(i);
      await processJob(job, undefined);
    }
    finish();
  }

  async function retry(groupId: string) {
    const job = jobs.current.find((j) => j.p.groupId === groupId);
    const from = progress[groupId];
    if (running.current || !job || from?.status !== "erro") return;
    running.current = true;
    const s = stats.current;
    s.total += callsFor(job, from);
    restartClock(s);
    publish();
    setCurrent(order.indexOf(groupId));
    update(groupId, { status: "aguardando", error: undefined });
    setPhase("running");
    await processJob(job, from);
    finish();
  }

  const statusLabel = (pr: Progress) =>
    pr.status === "aguardando"
      ? t("create.status.waiting")
      : pr.status === "criando"
        ? t("create.status.creating")
        : pr.status === "adicionando"
          ? t("create.status.adding", { added: pr.added, total: pr.total })
          : pr.status === "criada"
            ? t("create.status.created", { count: pr.added })
            : pr.status === "atualizada"
              ? t("create.status.updated", { count: pr.added })
              : pr.status === "nada novo"
                ? t("create.status.nothingNew")
                : pr.status === "erro"
                  ? pr.added > 0
                    ? t("create.status.errorPartial", { added: pr.added, total: pr.total })
                    : t("create.status.error")
                  : t("create.status.notCreated");
  const STATUS_STYLE: Partial<Record<Progress["status"], string>> = {
    aguardando: "text-areia",
    criando: "text-papel",
    adicionando: "text-papel",
    criada: "text-ok",
    atualizada: "text-ok",
    "nada novo": "text-ok",
    erro: "text-erro",
  };

  const byGroup = new Map(plan.map((p) => [p.groupId, p]));
  const currentProgress = progress[order[current]];
  const percent = calls.total === 0 ? (phase === "done" ? 100 : 0) : Math.min(100, (calls.done / calls.total) * 100);
  const doneCount = Object.values(progress).filter(
    (pr) => pr.status !== "aguardando" && pr.status !== "criando" && pr.status !== "adicionando",
  ).length;
  const failedCount = Object.values(progress).filter((pr) => pr.status === "erro").length;
  const head =
    phase === "done"
      ? [
          t("create.head.done", { done: doneCount - failedCount, total: order.length }),
          failedCount > 0 && t("create.head.failed", { count: failedCount }),
        ]
          .filter(Boolean)
          .join(" ")
      : [
          t("create.head.playlist", { n: Math.min(current + 1, order.length), total: order.length }),
          currentProgress?.status === "adicionando" &&
            t("create.head.batch", { batch: currentProgress.batch ?? 0, total: currentProgress.totalBatches ?? 0 }),
          calls.etaMs !== null && formatEta(i18n, calls.etaMs),
        ]
          .filter(Boolean)
          .join(" · ");

  const primary =
    "rounded-full bg-papel px-6 py-3 font-bold text-cafe transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
  const ghost = "rounded-full border border-fio px-5 py-2 transition-colors hover:border-areia hover:bg-grafite-2";
  const busy = phase === "running" || phase === "checking";

  // the page footer: the create button, or a compact progress line while the dialog is closed
  const footer = (phase === "idle" || !sheetOpen) && (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-fio bg-grafite/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        {phase === "idle" ? (
          <>
            <p className="text-sm text-areia" aria-live="polite">
              {disabledReason
                ? t("footer.analyzing")
                : outline.playlists === 0
                  ? t("footer.noneMarked")
                  : t("footer.review")}
            </p>
            <button
              className={`w-full sm:w-auto ${primary}`}
              disabled={!!disabledReason || outline.playlists === 0}
              onClick={openConfirm}
            >
              {disabledReason ??
                (outline.playlists === 0
                  ? t("footer.noGenre")
                  : t("footer.create", { count: outline.playlists, tracks: t("common.tracks", { count: outline.tracks }) }))}
            </button>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-2" aria-live="polite">
              <p className="truncate text-sm">{head}</p>
              <ProgressBar percent={percent} />
            </div>
            <button className={ghost} onClick={() => setSheetOpen(true)}>
              {phase === "done" ? t("footer.summary") : t("footer.details")}
            </button>
          </>
        )}
      </div>
    </div>
  );

  if (phase === "idle") return footer;

  const willCreate = plan.filter((p) => p.uris.length > 0).length;
  const title =
    phase === "checking"
      ? t("create.title.checking")
      : phase === "confirm"
        ? t("create.title.confirm", { count: willCreate })
        : phase === "running"
          ? t("create.title.running")
          : failedCount > 0
            ? t("create.title.doneErrors")
            : t("create.title.done");

  return (
    <>
      {footer}
      <dialog
        ref={dialog}
        tabIndex={-1}
        aria-labelledby="create-title"
        onCancel={(e) => {
          e.preventDefault();
          closeSheet();
        }}
        // a click on the backdrop lands on the dialog itself
        onClick={(e) => e.target === e.currentTarget && (phase === "running" || phase === "done") && closeSheet()}
        className="m-auto max-h-[min(52rem,calc(100dvh-2rem))] w-[min(44rem,calc(100%-2rem))] overflow-hidden rounded-2xl border border-fio bg-grafite p-0 text-papel shadow-2xl shadow-sombra/50"
      >
        <div className="flex max-h-[min(52rem,calc(100dvh-2rem))] flex-col">
          <header className="flex flex-none items-start justify-between gap-4 border-b border-fio px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-1">
              <h2 id="create-title" className="wide text-xl sm:text-2xl">
                {title}
              </h2>
              <p className="text-sm text-areia">
                {phase === "checking" ? t("create.sub.checking") : phase === "confirm" ? t("create.sub.confirm") : head}
              </p>
            </div>
            {phase !== "checking" && (
              <button
                className="grid size-9 flex-none place-items-center rounded-full text-areia transition-colors hover:bg-grafite-2 hover:text-papel"
                onClick={closeSheet}
                aria-label={phase === "confirm" ? t("common.cancel") : t("create.hide")}
              >
                <svg aria-hidden viewBox="0 0 16 16" className="size-4">
                  <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 sm:px-6">
            {busy && <RateLimitNotice queue={spotify} service="Spotify" />}

            {phase === "checking" && (
              <ul className="flex flex-col gap-2" aria-busy>
                {plan.map((p) => (
                  <li key={p.groupId} className="flex items-center gap-3 rounded-lg border border-fio p-3">
                    <span className="size-2.5 flex-none rounded-full" style={{ background: genreColor(p.groupId) }} />
                    <span className="flex-1 truncate font-bold">{p.name}</span>
                    <span className="skeleton h-4 w-24" />
                  </li>
                ))}
              </ul>
            )}

            {phase === "confirm" && (
              <>
                {warnings.uncertain.length > 0 && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-alerta/60 bg-alerta/10 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="check mt-0.5"
                      checked={uncertainOk}
                      onChange={(e) => setUncertainOk(e.target.checked)}
                    />
                    <span>
                      {rich(
                        "create.uncertain",
                        { count: warnings.uncertain.length, names: list(warnings.uncertain.map((w) => w.name)) },
                        { b: (c) => <span className="font-bold text-alerta">{c}</span> },
                      )}
                    </span>
                  </label>
                )}
                {warnings.lowConfidence.length > 0 && (
                  <div className="rounded-lg border border-alerta/40 bg-alerta/5 p-3 text-sm" role="note">
                    <p className="font-bold text-alerta">{t("create.lowTitle")}</p>
                    <ul className="mt-1 text-areia">
                      {warnings.lowConfidence.map((w) => (
                        <li key={w.groupId}>
                          {rich(
                            "create.lowItem",
                            { name: w.name, percent: Math.round(w.share * 100) },
                            { name: (c) => <span className="text-papel">{c}</span> },
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-areia">{t("create.lowHint")}</p>
                  </div>
                )}
                {checkError && (
                  <div className="rounded-lg border border-erro/40 bg-erro/10 p-3 text-sm">
                    <p>{t("create.checkError")}</p>
                    <RawError error={checkError} />
                  </div>
                )}
                <ul className="flex flex-col gap-2">
                  {plan.map((p) => {
                    const match = existing[p.groupId];
                    const mode = modes[p.groupId];
                    const setMode = (m: Mode) => setModes({ ...modes, [p.groupId]: m });
                    const color = genreColor(p.groupId);
                    return (
                      <li
                        key={p.groupId}
                        className="flex flex-col gap-2 rounded-lg border border-fio bg-cafe/40 p-3 pl-4"
                        style={{ borderLeft: `4px solid ${p.uris.length > 0 ? color : "var(--color-fio)"}` }}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 truncate font-bold">{p.name}</p>
                          <p className="flex-none text-sm text-areia">
                            <span className="num mr-1 text-2xl" style={{ color }}>
                              {n(p.uris.length)}
                            </span>
                            {t("create.tracksUnit", { count: p.uris.length })}
                          </p>
                        </div>
                        {p.ignored > 0 && (
                          <p className="text-xs text-areia">{t("create.ignored", { count: p.ignored })}</p>
                        )}
                        {match ? (
                          <fieldset className="flex flex-col gap-2">
                            <legend className="sr-only">{t("create.whatToDo", { name: p.name })}</legend>
                            <div className="flex flex-wrap gap-2 text-sm">
                              <ModeOption
                                name={p.groupId}
                                checked={mode === "update"}
                                onChange={() => setMode("update")}
                                label={
                                  match.newUris.length > 0
                                    ? t("create.updateExisting", { count: match.newUris.length })
                                    : t("create.updateNothing")
                                }
                              />
                              <ModeOption
                                name={p.groupId}
                                checked={mode === "create"}
                                onChange={() => setMode("create")}
                                label={t("create.createNew", { visibility: t(isPublic ? "create.public" : "create.private") })}
                              />
                            </div>
                            <p className="text-xs text-areia">
                              {t("create.exists")}{" "}
                              <a className="text-papel underline underline-offset-2" href={match.url} target="_blank" rel="noreferrer">
                                {t("create.viewOnSpotify")}
                              </a>
                              {match.matches > 1 && (
                                <span className="text-alerta"> {t("create.manyMatches", { count: match.matches })}</span>
                              )}
                            </p>
                          </fieldset>
                        ) : p.uris.length === 0 ? (
                          <p className="text-xs text-erro">{t("create.willNotCreate")}</p>
                        ) : (
                          <p className="text-xs text-areia">
                            {t("create.newPlaylist", { visibility: t(isPublic ? "create.public" : "create.private") })}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {(phase === "running" || phase === "done") && (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="flex items-baseline gap-1.5">
                      <span className="num text-5xl">{n(phase === "done" ? doneCount - failedCount : Math.min(current + 1, order.length))}</span>
                      <span className="text-areia">
                        {t(phase === "done" ? "create.ofDone" : "create.ofPlaylists", { total: order.length })}
                      </span>
                    </p>
                    {phase === "running" && calls.etaMs !== null && (
                      <p className="text-sm text-areia">{formatEta(i18n, calls.etaMs)}</p>
                    )}
                  </div>
                  <ProgressBar percent={percent} />
                </div>
                <ul className="flex flex-col">
                  {order.map((id) => {
                    const p = byGroup.get(id);
                    const pr = progress[id];
                    if (!p || !pr) return null;
                    const color = genreColor(id);
                    const working = pr.status === "criando" || pr.status === "adicionando";
                    return (
                      <li key={id} className="flex flex-col gap-1.5 border-t border-fio py-3 first:border-t-0">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden
                            className={`size-2.5 flex-none rounded-full ${working ? "animate-pulse" : ""}`}
                            style={{ background: pr.status === "aguardando" ? "var(--color-fio)" : color }}
                          />
                          <span className="min-w-0 flex-1 truncate font-bold">{p.name}</span>
                          <span className={`flex-none text-right text-sm ${STATUS_STYLE[pr.status] ?? "text-areia"}`}>
                            {statusLabel(pr)}
                          </span>
                        </div>
                        {pr.total > 0 && (
                          <div className="ml-5.5 h-1 overflow-hidden rounded-full bg-cafe" aria-hidden>
                            <div
                              className="h-full rounded-full transition-[width] duration-300"
                              style={{ width: `${(pr.added / pr.total) * 100}%`, background: color }}
                            />
                          </div>
                        )}
                        {phase === "done" && (
                          <p className="ml-5.5 text-xs text-areia">
                            {t("create.addedIgnored", { added: pr.added, ignored: p.ignored })}
                            {pr.url && (
                              <>
                                {" · "}
                                <a className="text-papel underline underline-offset-2" href={pr.url} target="_blank" rel="noreferrer">
                                  {t("create.open")}
                                </a>
                              </>
                            )}
                          </p>
                        )}
                        {pr.error && (
                          <div className="ml-5.5 flex flex-col items-start gap-2 rounded-lg border border-erro/40 bg-erro/10 p-2.5">
                            <RawError error={pr.error} />
                            {phase === "done" && (
                              <button
                                className="rounded-full border border-fio px-3 py-1 text-sm transition-colors hover:border-areia hover:bg-grafite-2 disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={!!disabledReason}
                                title={disabledReason}
                                onClick={() => retry(id)}
                              >
                                {t("create.retry")}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {phase === "confirm" && (
            <footer className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-fio px-5 py-4 sm:px-6">
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" className="check" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                <span>
                  {t("create.makePublic")}
                  <span className="block text-xs text-areia">{t("create.publicHint")}</span>
                </span>
              </label>
              <div className="flex w-full gap-2 sm:w-auto">
                <button className={ghost} onClick={closeSheet}>
                  {t("common.cancel")}
                </button>
                <button
                  className={`flex-1 sm:flex-none ${primary}`}
                  disabled={!!disabledReason || (warnings.uncertain.length > 0 && !uncertainOk)}
                  title={warnings.uncertain.length > 0 && !uncertainOk ? t("create.confirmUncertainTitle") : undefined}
                  onClick={run}
                >
                  {disabledReason ?? t("create.confirm")}
                </button>
              </div>
            </footer>
          )}
          {phase === "done" && (
            <footer className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-fio px-5 py-4 sm:px-6">
              <p className="text-xs text-areia">{t("create.reload")}</p>
              <button className={ghost} onClick={closeSheet}>
                {t("common.close")}
              </button>
            </footer>
          )}
        </div>
      </dialog>
    </>
  );
});

function ProgressBar({ percent }: { percent: number }) {
  const { t } = useI18n();
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-cafe"
      role="progressbar"
      aria-label={t("create.progress")}
      aria-valuenow={Math.round(percent)}
    >
      <div className="h-full rounded-full bg-papel transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
  );
}

function ModeOption({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label
      className={`cursor-pointer rounded-full border px-3 py-1.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-papel ${
        checked ? "border-papel bg-papel font-bold text-cafe" : "border-fio text-areia hover:border-areia hover:text-papel"
      }`}
    >
      <input type="radio" name={`mode-${name}`} className="sr-only" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
