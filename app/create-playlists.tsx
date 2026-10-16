"use client";

import { useRef, useState } from "react";
import type { ClassifiedTrack } from "@/lib/classify";
import { chunk, findSplitterPlaylists, missingUris, planPlaylists, TRACK_URI, type PlannedPlaylist } from "@/lib/playlist-plan";
import type { Group } from "@/lib/preview-state";
import type { ApiError, ApiResult } from "@/lib/spotify";
import { spotify } from "@/lib/spotify-client";
import { addTracks, createPlaylist } from "./actions";
import { invalidatePlaylists, loadMe, loadPlaylists, loadTracks } from "./spotify-data";

type Mode = "update" | "create";

type Progress = {
  status:
    | "pendente"
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
  url?: string;
  error?: ApiError;
};

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
        existing.data.map((t) => t.uri).filter((u): u is string => !!u),
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

export function CreatePlaylists({
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
  // state updates are async; the ref blocks a second click landing before re-render
  const running = useRef(false);

  const update = (groupId: string, p: Partial<Progress>) =>
    setProgress((prev) => ({ ...prev, [groupId]: { ...prev[groupId], ...p } }));

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

  async function addInBatches(groupId: string, playlistId: string, uris: string[]) {
    const batches = chunk(uris);
    let added = 0;
    for (let i = 0; i < batches.length; i++) {
      update(groupId, { status: "adicionando", batch: i + 1, totalBatches: batches.length });
      const r = await spotify.call(() => addTracks(playlistId, batches[i]), `/playlists/${playlistId}/items`);
      if (!r.ok) return { added, error: r };
      added += batches[i].length;
      update(groupId, { added });
    }
    return { added, error: undefined };
  }

  async function run() {
    if (running.current) return;
    running.current = true;
    setPhase("running");
    setProgress(Object.fromEntries(plan.map((p) => [p.groupId, { status: "pendente", added: 0 } as Progress])));

    for (const p of plan) {
      const match = existing[p.groupId];
      if (modes[p.groupId] === "update" && match) {
        update(p.groupId, { url: match.url });
        if (match.newUris.length === 0) {
          update(p.groupId, { status: "nada novo" });
          continue;
        }
        const { added, error } = await addInBatches(p.groupId, match.playlistId, match.newUris);
        update(p.groupId, error ? { status: "erro", error, added } : { status: "atualizada", added });
        continue;
      }

      if (p.uris.length === 0) {
        update(p.groupId, { status: "não criada" });
        continue;
      }
      update(p.groupId, { status: "criando" });
      const created = await spotify.call(() => createPlaylist(p.name, isPublic), "/me/playlists");
      if (!created.ok) {
        update(p.groupId, { status: "erro", error: created });
        continue;
      }
      update(p.groupId, { url: created.data.url });
      const { added, error } = await addInBatches(p.groupId, created.data.id, p.uris);
      update(p.groupId, error ? { status: "erro", error, added } : { status: "criada", added });
    }

    // stays disabled after finishing so the same playlists aren't created twice by accident
    setPhase("done");
    invalidatePlaylists();
    onDone();
  }

  const statusLabel = (pr: Progress) =>
    pr.status === "adicionando"
      ? `adicionando lote ${pr.batch}/${pr.totalBatches}`
      : pr.status === "atualizada"
        ? `atualizada (+${pr.added} faixas)`
        : pr.status;

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      {phase === "idle" && (
        <button
          className="self-start rounded-full bg-green-600 px-5 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-40"
          disabled={!!disabledReason || planPlaylists(groups, tracks).length === 0}
          onClick={openConfirm}
        >
          {disabledReason ?? "Criar playlists selecionadas"}
        </button>
      )}

      {phase === "checking" && <p>Verificando playlists já criadas pelo Playlist Splitter…</p>}

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
          <p className="font-semibold">{phase === "running" ? "Processando…" : "Resumo"}</p>
          <ul className="flex flex-col gap-2">
            {plan.map((p) => {
              const pr = progress[p.groupId];
              if (!pr) return null;
              return (
                <li key={p.groupId} className={pr.status === "erro" ? "rounded bg-red-50 p-2" : ""}>
                  <p>
                    <strong>{p.name}</strong> — {statusLabel(pr)}
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
                </li>
              );
            })}
          </ul>
          {phase === "done" && <p className="text-xs text-gray-500">Para rodar de novo, recarregue a página.</p>}
        </div>
      )}
    </div>
  );
}
