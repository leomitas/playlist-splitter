"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { markIncoherent } from "@/lib/classify";
import { OTHER } from "@/lib/genre-families";
import { isSplitterPlaylist } from "@/lib/playlist-plan";
import { isReadablePlaylist, LIKED_ID, type ApiResult, type LikedSummary, type Me, type Playlist } from "@/lib/spotify";
import { AnalysisPanel } from "./analysis-panel";
import { analysis, previewStorageKey } from "./analysis-queue";
import { PlaylistPicker } from "./playlist-picker";
import { Preview } from "./preview";
import { RawError } from "./raw-error";
import { likedAsPlaylist, loadLikedSummary, loadMe, loadPlaylists } from "./spotify-data";

export function SpotifyApp() {
  const [me, setMe] = useState<ApiResult<Me> | null>(null);
  const [playlists, setPlaylists] = useState<ApiResult<Playlist[]> | null>(null);
  const [liked, setLiked] = useState<ApiResult<LikedSummary> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // local state only: nothing in the URL, so a reload doesn't trigger any call by itself
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [cacheCleared, setCacheCleared] = useState(false);
  const run = useSyncExternalStore(analysis.subscribe, analysis.get, () => null);

  const refreshPlaylists = useCallback(async (force: boolean) => {
    setRefreshing(true);
    setPlaylists(await loadPlaylists(force));
    setLiked(await loadLikedSummary(force));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void analysis.restore();
    void (async () => {
      setMe(await loadMe());
      await refreshPlaylists(false);
    })();
  }, [refreshPlaylists]);

  // coherence flags depend on the whole set, so they're recomputed as tracks arrive
  const tracks = useMemo(() => {
    const copy = (run?.tracks ?? []).map((t) => ({ ...t }));
    markIncoherent(copy);
    return copy;
  }, [run?.tracks]);
  const stats = useMemo(
    () => ({
      lowConfidence: tracks.filter((t) => t.lowConfidence).length,
      other: tracks.filter((t) => t.family === OTHER).length,
    }),
    [tracks],
  );

  // the API doesn't return items for playlists the user neither owns nor collaborates on
  // liked songs first; playlists created by this app are left out so they aren't re-analyzed
  const readable = useMemo(
    () =>
      me?.ok && playlists?.ok
        ? [
            ...(liked?.ok ? [likedAsPlaylist(liked.data, me.data)] : []),
            ...playlists.data.filter((p) => isReadablePlaylist(p, me.data.id) && !isSplitterPlaylist(p, me.data.id)),
          ]
        : [],
    [me, playlists, liked],
  );
  const pickerItems = useMemo(
    () =>
      readable.map((p) => ({
        id: p.id,
        name: liked?.ok && p.id === LIKED_ID ? `${p.name} (${liked.data.total.toLocaleString("pt-BR")})` : p.name,
      })),
    [readable, liked],
  );
  // drop selections that disappeared after "Atualizar lista"
  const chosen = useMemo(() => readable.filter((p) => selected.has(p.id)), [readable, selected]);

  const toggleSelected = useCallback(
    (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const setAllSelected = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const onSpotifyChanged = useCallback(() => refreshPlaylists(true), [refreshPlaylists]);

  if (!me) return <p className="text-sm">Carregando perfil…</p>;
  const active = run?.phase === "running" || run?.phase === "paused";

  async function clearCache() {
    await analysis.clearCache();
    setCacheCleared(true);
    await refreshPlaylists(true);
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex items-center gap-4">
        {me.ok ? (
          <>
            {me.data.images?.[0] && (
              <Image src={me.data.images[0].url} alt="" width={64} height={64} className="rounded-full" />
            )}
            <div>
              <p className="text-lg font-semibold">{me.data.display_name ?? "(sem nome)"}</p>
              <p className="text-sm text-gray-600">{me.data.email ?? "e-mail não retornado pela API"}</p>
            </div>
          </>
        ) : (
          <RawError error={me} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Playlists {playlists?.ok && `(${readable.length})`}</h2>
          <div className="flex gap-2">
            <button
              className="rounded border px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-40"
              disabled={active}
              onClick={clearCache}
              title="Apaga faixas e gêneros guardados neste navegador"
            >
              {cacheCleared ? "Cache limpo" : "Limpar cache"}
            </button>
            <button
              className="rounded border px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-40"
              disabled={refreshing}
              onClick={() => refreshPlaylists(true)}
            >
              {refreshing ? "Atualizando…" : "Atualizar lista"}
            </button>
          </div>
        </div>
        {!playlists ? (
          <p className="text-sm">Carregando playlists…</p>
        ) : !playlists.ok ? (
          <RawError error={playlists} />
        ) : !me.ok ? (
          <p className="text-sm text-red-700">Sem o ID do usuário (erro acima) não dá para filtrar as playlists.</p>
        ) : (
          <>
            {liked && !liked.ok && (
              <div className="flex flex-col gap-1 text-sm">
                <p>Músicas curtidas: não foi possível ler (as outras playlists funcionam normalmente).</p>
                <RawError error={liked} />
              </div>
            )}
            <PlaylistPicker
              playlists={pickerItems}
              selected={selected}
              disabled={active}
              onToggle={toggleSelected}
              onSetAll={setAllSelected}
            />
          </>
        )}
        <button
          className="self-start rounded-full bg-green-600 px-5 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-40"
          disabled={active || chosen.length === 0}
          onClick={() => {
            setCacheCleared(false);
            analysis.start(chosen);
          }}
        >
          Analisar selecionadas{chosen.length > 0 && ` (${chosen.length})`}
        </button>
        {active && <p className="text-xs text-gray-600">Cancele a análise atual para começar outra.</p>}
      </section>

      {run && (
        <AnalysisPanel
          run={run}
          onPause={analysis.pause}
          onResume={() => analysis.resume(readable)}
          onCancel={analysis.cancel}
          onReprocess={analysis.reprocess}
        />
      )}

      {run && tracks.length > 0 && (
        <section className="flex flex-col gap-3 text-sm">
          <h2 className="font-semibold">Prévia por gênero</h2>
          <p className="text-gray-600">
            {tracks.length} faixas únicas ({run.totalTracks - tracks.length} repetidas removidas) ·{" "}
            {stats.lowConfidence} de baixa confiança · {stats.other} sem família
          </p>
          <Preview
            key={run.id}
            tracks={tracks}
            storageKey={previewStorageKey(run.id)}
            createDisabledReason={active ? "Aguarde a análise terminar" : undefined}
            onSpotifyChanged={onSpotifyChanged}
          />
        </section>
      )}
    </div>
  );
}
