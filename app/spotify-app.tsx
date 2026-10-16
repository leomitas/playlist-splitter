"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { markIncoherent } from "@/lib/classify";
import { isSplitterPlaylist } from "@/lib/playlist-plan";
import { isReadablePlaylist, LIKED_ID, type ApiResult, type LikedSummary, type Me, type Playlist } from "@/lib/spotify";
import { AnalysisPanel } from "./analysis-panel";
import { analysis, previewStorageKey } from "./analysis-queue";
import { PlaylistPicker } from "./playlist-picker";
import { Preview } from "./preview";
import { RawError } from "./raw-error";
import { likedAsPlaylist, loadLikedSummary, loadMe, loadPlaylists } from "./spotify-data";

export function SpotifyApp({ logout }: { logout: React.ReactNode }) {
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

  const active = run?.phase === "running" || run?.phase === "paused";
  const step = run && tracks.length > 0 && !active ? 3 : 2;

  if (!me) return <AppSkeleton logout={logout} />;

  async function clearCache() {
    await analysis.clearCache();
    setCacheCleared(true);
    await refreshPlaylists(true);
  }

  return (
    <div className="flex w-full flex-1 flex-col self-stretch">
      <header className="z-20 border-b border-fio bg-cafe/95 backdrop-blur lg:sticky lg:top-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
          <h1 className="wide text-lg sm:text-xl">Playlist Splitter</h1>
          <div className="order-last w-full lg:order-none lg:w-auto">
            <Steps current={step} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            {me.ok && (
              <>
                {me.data.images?.[0] && (
                  <Image src={me.data.images[0].url} alt="" width={32} height={32} className="size-8 rounded-full" />
                )}
                <span className="hidden max-w-40 truncate text-sm sm:inline" title={me.data.email ?? undefined}>
                  {me.data.display_name ?? "(sem nome)"}
                </span>
              </>
            )}
            {logout}
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 flex-1 items-start gap-8 px-4 pt-6 pb-36 sm:px-6 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-12">
        <aside
          className="flex flex-col gap-5 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:pr-2"
          aria-label="Escolher e analisar"
        >
          {!me.ok && <RawError error={me} />}

          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">
              Suas playlists{" "}
              {playlists?.ok && <span className="font-normal text-areia">{readable.length}</span>}
            </h2>
            <div className="flex gap-3 text-sm">
              <button
                className="text-areia underline-offset-4 transition-colors hover:text-papel hover:underline disabled:opacity-40 disabled:hover:no-underline"
                disabled={refreshing}
                onClick={() => refreshPlaylists(true)}
              >
                {refreshing ? "Atualizando…" : "Atualizar"}
              </button>
              <button
                className="text-areia underline-offset-4 transition-colors hover:text-papel hover:underline disabled:opacity-40 disabled:hover:no-underline"
                disabled={active}
                onClick={clearCache}
                title="Apaga faixas e gêneros guardados neste navegador"
              >
                {cacheCleared ? "Cache limpo" : "Limpar cache"}
              </button>
            </div>
          </div>

          {!playlists ? (
            <PickerSkeleton />
          ) : !playlists.ok ? (
            <RawError error={playlists} />
          ) : !me.ok ? (
            <p className="text-sm text-erro">Sem o ID do usuário (erro acima) não dá para filtrar as playlists.</p>
          ) : (
            <>
              {liked && !liked.ok && (
                <div className="flex flex-col gap-1 text-sm">
                  <p>Não foi possível ler as músicas curtidas. As outras playlists funcionam normalmente.</p>
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
            className="rounded-full bg-papel px-5 py-3 font-bold text-cafe transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={active || chosen.length === 0}
            onClick={() => {
              setCacheCleared(false);
              analysis.start(chosen);
            }}
          >
            {chosen.length === 0
              ? "Escolha playlists para analisar"
              : `Analisar ${chosen.length} ${chosen.length === 1 ? "playlist" : "playlists"}`}
          </button>
          {active && <p className="-mt-3 text-sm text-areia">Cancele a análise atual para começar outra.</p>}

          {run && (
            <AnalysisPanel
              run={run}
              onPause={analysis.pause}
              onResume={() => analysis.resume(readable)}
              onCancel={analysis.cancel}
              onReprocess={analysis.reprocess}
            />
          )}
        </aside>

        <section className="flex min-w-0 flex-col gap-6" aria-label="Revisar e criar">
          {run && tracks.length > 0 ? (
            <Preview
              key={run.id}
              tracks={tracks}
              duplicates={run.totalTracks - tracks.length}
              storageKey={previewStorageKey(run.id)}
              createDisabledReason={active ? "Aguarde a análise terminar" : undefined}
              onSpotifyChanged={onSpotifyChanged}
            />
          ) : active ? (
            <SpectrumSkeleton text="Lendo as primeiras faixas. Os gêneros aparecem aqui conforme cada playlist termina." />
          ) : (
            <SpectrumSkeleton
              text="Escolha playlists ao lado e analise para ver suas músicas separadas por gênero."
              still
            />
          )}
        </section>
      </div>
    </div>
  );
}

const STEPS = ["Conectar", "Escolher e analisar", "Revisar e criar"];

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Etapas">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={n} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={`h-px w-4 sm:w-8 ${n <= current ? "bg-papel" : "bg-fio"}`} />}
            <span
              aria-hidden
              className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                state === "current"
                  ? "bg-papel text-cafe"
                  : state === "done"
                    ? "border border-papel text-papel"
                    : "border border-fio text-areia"
              }`}
            >
              {state === "done" ? "✓" : n}
            </span>
            <span className={state === "current" ? "font-bold" : "sr-only text-areia md:not-sr-only"}>
              {label}
              {state === "done" && <span className="sr-only"> (concluído)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PickerSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Carregando playlists">
      {[70, 55, 80, 45, 65, 50].map((w, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton size-6" />
          <div className="skeleton h-4" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

// Grey bands in the shape of the spectrum: loading (pulsing) or empty (still)
function SpectrumSkeleton({ text, still }: { text: string; still?: boolean }) {
  const bands = [30, 18, 14, 11, 9, 7, 6, 5];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-16 gap-1 overflow-hidden rounded-lg" aria-hidden>
        {bands.map((w, i) => (
          <div
            key={i}
            className={still ? "rounded-sm bg-grafite-2" : "skeleton rounded-sm"}
            style={{ flexGrow: w, opacity: still ? 1 - i * 0.09 : undefined }}
          />
        ))}
      </div>
      <p className="max-w-[48ch] text-lg text-areia">{text}</p>
    </div>
  );
}

function AppSkeleton({ logout }: { logout: React.ReactNode }) {
  return (
    <div className="flex w-full flex-1 flex-col self-stretch" aria-busy>
      <header className="border-b border-fio">
        <div className="mx-auto flex max-w-7xl items-center gap-8 px-4 py-3 sm:px-6">
          <h1 className="wide text-lg sm:text-xl">Playlist Splitter</h1>
          <div className="ml-auto">{logout}</div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 px-4 pt-6 sm:px-6 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-12">
        <PickerSkeleton />
        <SpectrumSkeleton text="Carregando seu perfil…" />
      </div>
    </div>
  );
}
