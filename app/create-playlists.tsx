"use client";

import { memo, useMemo, useRef, useState } from "react";
import type { ClassifiedTrack } from "@/lib/classify";
import { chunk, findSplitterPlaylists, missingUris, planPlaylists, TRACK_URI, type PlannedPlaylist } from "@/lib/playlist-plan";
import type { Group } from "@/lib/preview-state";
import type { ApiError, ApiResult } from "@/lib/spotify";
import { spotify } from "@/lib/spotify-client";
import { addTracks, createPlaylist } from "./actions";
import { formatEta } from "./analysis-panel";
import { RateLimitNotice } from "./rate-limit-notice";
import { invalidatePlaylists, loadMe, loadPlaylists, loadTracks } from "./spotify-data";

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
};

// Read-only: looks for playlists this app created earlier with the same name
async function findExisting(planned: PlannedPlaylist[]): Promise<ApiResult<Record<string, ExistingMatch | null>>> {
  const me = await loadMe();
  if (!me.ok) return me;
  // fresh list: playlists created moments ago (or edited in the app) must be seen
  const playlists = await loadPlaylists(true);
  if (!playlists.ok) return playlists;

  const result: Record<string, ExistingMatch | null> = {};
  for (const p of planned) {
    const found = findSplitterPlaylists(playlists.data, me.data.id, p.name);
    if (found.length === 0) {
      result[p.groupId] = null;
      continue;
    }
    const existing = await loadTracks(found[0]);
    if (!existing.ok) return existing;
    result[p.groupId] = {
      playlistId: found[0].id,
      url: `https://open.spotify.com/playlist/${found[0].id}`,
      newUris: missingUris(
        p.uris.filter((u) => TRACK_URI.test(u)),
        existing.data.tracks.map((t) => t.uri).filter((u): u is string => !!u),
      ),
      matches: found.length,
    };
  }
  return { ok: true, data: result };
}

function RawError({ error }: { error: ApiError }) {
  return (
    <div className="mt-1 text-xs text-red-800">
      <p className="font-semibold">
        {error.method ?? "POST"} {error.url} → {error.status ?? "sem resposta"}
      </p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{error.raw}</pre>
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
  const [phase, setPhase] = useState<"idle" | "checking" | "confirm" | "running" | "done">("idle");
  const [plan, setPlan] = useState<PlannedPlaylist[]>([]);
  const [existing, setExisting] = useState<Record<string, ExistingMatch | null>>({});
  const [checkError, setCheckError] = useState<ApiError | null>(null);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [isPublic, setIsPublic] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  // group ids in execution order, and the index of the one being processed
  const [order, setOrder] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [calls, setCalls] = useState<CallStats>({ done: 0, total: 0, etaMs: null });
  // state updates are async; the ref blocks a second click landing before re-render
  const running = useRef(false);
  const jobs = useRef<Job[]>([]);
  const stats = useRef<Clock>({ total: 0, done: 0, doneAtStart: 0, startedAt: 0 });
  const hasPlan = useMemo(() => planPlaylists(groups, tracks).length > 0, [groups, tracks]);

  const update = (groupId: string, p: Partial<Progress>) =>
    setProgress((prev) => ({ ...prev, [groupId]: { ...prev[groupId], ...p } }));

  const publish = () => setCalls(readClock(stats.current));

  async function openConfirm() {
    const planned = planPlaylists(groups, tracks);
    setPlan(planned);
    setPhase("checking");
    const r = await findExisting(planned);
    const found = r.ok ? r.data : {};
    setCheckError(r.ok ? null : r);
    setExisting(found);
    setModes(Object.fromEntries(planned.map((p) => [p.groupId, found[p.groupId] ? "update" : "create"])));
    setPhase("confirm");
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
    invalidatePlaylists();
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

  const fmt = (n: number) => n.toLocaleString("pt-BR");
  const statusLabel = (pr: Progress) =>
    pr.status === "aguardando"
      ? "Na fila"
      : pr.status === "criando"
        ? "Criando…"
        : pr.status === "adicionando"
          ? `Adicionando ${fmt(pr.added)}/${fmt(pr.total)}`
          : pr.status === "criada"
            ? `Concluída · criada com ${fmt(pr.added)} faixas`
            : pr.status === "atualizada"
              ? `Concluída · atualizada (+${fmt(pr.added)} faixas)`
              : pr.status === "nada novo"
                ? "Concluída · nada novo"
                : pr.status === "erro"
                  ? `Erro${pr.added > 0 ? ` (${fmt(pr.added)} de ${fmt(pr.total)} faixas adicionadas)` : ""}`
                  : "Não criada (sem faixas válidas)";
  const STATUS_STYLE: Partial<Record<Progress["status"], string>> = {
    aguardando: "text-gray-500",
    criando: "text-blue-700",
    adicionando: "text-blue-700",
    criada: "text-green-700",
    atualizada: "text-green-700",
    "nada novo": "text-green-700",
    erro: "text-red-700",
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
      ? `Concluído: ${fmt(doneCount - failedCount)} de ${fmt(order.length)} playlists${failedCount ? ` · ${fmt(failedCount)} com erro` : ""}`
      : [
          `Playlist ${fmt(Math.min(current + 1, order.length))} de ${fmt(order.length)}`,
          currentProgress?.status === "adicionando" && `lote ${currentProgress.batch}/${currentProgress.totalBatches}`,
          calls.etaMs !== null && formatEta(calls.etaMs),
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      {phase === "idle" && (
        <button
          className="self-start rounded-full bg-green-600 px-5 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-40"
          disabled={!!disabledReason || !hasPlan}
          onClick={openConfirm}
        >
          {disabledReason ?? "Criar playlists selecionadas"}
        </button>
      )}

      {phase === "checking" && <p>Verificando playlists já criadas pelo Playlist Splitter…</p>}
      {(phase === "checking" || phase === "running") && <RateLimitNotice queue={spotify} service="Spotify" />}

      {phase === "confirm" && (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Confirmar no Spotify</p>
          {checkError && (
            <div className="rounded bg-red-50 p-2">
              <p className="text-xs">
                Não foi possível verificar playlists existentes; todas serão criadas como novas.
              </p>
              <RawError error={checkError} />
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {plan.map((p) => {
              const match = existing[p.groupId];
              const mode = modes[p.groupId];
              const setMode = (m: Mode) => setModes({ ...modes, [p.groupId]: m });
              return (
                <li key={p.groupId} className="rounded border p-2">
                  <p>
                    <strong>{p.name}</strong> — {p.uris.length} faixas
                    {p.ignored > 0 && <span className="text-gray-500"> ({p.ignored} ignoradas: sem URI válida)</span>}
                  </p>
                  {match ? (
                    <div className="flex flex-col text-xs">
                      <label className="flex items-center gap-1">
                        <input type="radio" checked={mode === "update"} onChange={() => setMode("update")} />
                        {match.newUris.length > 0
                          ? `Atualizar existente (+${match.newUris.length} novas)`
                          : "Atualizar existente — nada novo para adicionar"}
                        <a className="text-green-700 underline" href={match.url} target="_blank" rel="noreferrer">
                          ver
                        </a>
                        {match.matches > 1 && (
                          <span className="text-yellow-800">({match.matches} com esse nome; usando a primeira)</span>
                        )}
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="radio" checked={mode === "create"} onChange={() => setMode("create")} />
                        Criar nova ({isPublic ? "pública" : "privada"})
                      </label>
                    </div>
                  ) : p.uris.length === 0 ? (
                    <p className="text-xs text-red-700">Não será criada (sem faixas válidas)</p>
                  ) : (
                    <p className="text-xs">Criar nova ({isPublic ? "pública" : "privada"})</p>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            Tornar públicas as playlists novas (padrão: privadas; as existentes não mudam)
          </label>
          <div className="flex gap-2">
            <button
              className="rounded-full bg-green-600 px-5 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-40"
              disabled={!!disabledReason}
              onClick={run}
            >
              {disabledReason ?? "Confirmar"}
            </button>
            <button className="rounded-full border px-5 py-2 hover:bg-gray-100" onClick={() => setPhase("idle")}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {(phase === "running" || phase === "done") && (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">{head}</p>
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200" role="progressbar" aria-valuenow={Math.round(percent)}>
            <div className="h-full bg-green-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <ul className="flex flex-col gap-2">
            {order.map((id) => {
              const p = byGroup.get(id);
              const pr = progress[id];
              if (!p || !pr) return null;
              return (
                <li key={p.groupId} className={pr.status === "erro" ? "rounded bg-red-50 p-2" : ""}>
                  <p>
                    <strong>{p.name}</strong> — <span className={STATUS_STYLE[pr.status]}>{statusLabel(pr)}</span>
                  </p>
                  {phase === "done" && (
                    <p className="text-xs text-gray-600">
                      {pr.added} adicionadas · {p.ignored} ignoradas
                      {pr.url && (
                        <>
                          {" · "}
                          <a className="text-green-700 underline" href={pr.url} target="_blank" rel="noreferrer">
                            abrir no Spotify
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  {pr.error && <RawError error={pr.error} />}
                  {pr.status === "erro" && phase === "done" && (
                    <button
                      className="mt-1 rounded border bg-white px-2 py-0.5 text-xs hover:bg-gray-100"
                      onClick={() => retry(p.groupId)}
                    >
                      Tentar de novo
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {phase === "done" && <p className="text-xs text-gray-500">Para rodar de novo, recarregue a página.</p>}
        </div>
      )}
    </div>
  );
});
