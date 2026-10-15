"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import type { ClassifiedTrack } from "@/lib/classify";
import { OTHER } from "@/lib/genre-families";
import { isReadablePlaylist, type ApiError, type ApiResult, type Me, type Playlist, type PlaylistTrack } from "@/lib/spotify";
import { analyzeTracks } from "./actions";
import { PlaylistPicker } from "./playlist-picker";
import { Preview } from "./preview";
import { RateLimitNotice } from "./rate-limit-notice";
import { RawError } from "./raw-error";
import { loadMe, loadPlaylists, loadTracks } from "./spotify-data";

const MAX_SELECTED = 5;

type Analysis = {
  ids: string[];
  classified: ClassifiedTrack[];
  total: number;
  fetchErrors: ApiError[];
  lastfmErrors: ApiError[];
};

export function SpotifyApp() {
  const [me, setMe] = useState<ApiResult<Me> | null>(null);
  const [playlists, setPlaylists] = useState<ApiResult<Playlist[]> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const refreshPlaylists = useCallback(async (force: boolean) => {
    setRefreshing(true);
    setPlaylists(await loadPlaylists(force));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void (async () => {
      setMe(await loadMe());
      await refreshPlaylists(false);
    })();
  }, [refreshPlaylists]);

  const readable =
    me?.ok && playlists?.ok ? playlists.data.filter((p) => isReadablePlaylist(p, me.data.id)) : [];
  // drop selections that disappeared after "Atualizar lista"
  const chosen = selected
    .map((id) => readable.find((p) => p.id === id))
    .filter((p): p is Playlist => !!p);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_SELECTED ? [...s, id] : s));
  }

  async function analyze() {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    setAnalysis(null);

    const fetchErrors: ApiError[] = [];
    const unique = new Map<string, PlaylistTrack>();
    let total = 0;
    for (const [i, p] of chosen.entries()) {
      const label = `Playlist ${i + 1} de ${chosen.length} (${p.name})`;
      setProgress(`${label}…`);
      const r = await loadTracks(p, (done, all) => setProgress(`${label}, faixas ${done}/${all}`));
      if (!r.ok) {
        fetchErrors.push(r);
        continue;
      }
      total += r.data.length;
      for (const t of r.data) if (!unique.has(t.key)) unique.set(t.key, t);
    }

    setProgress("Buscando gêneros no Last.fm…");
    const tracks = [...unique.values()].map((t) => ({ key: t.key, uri: t.uri, name: t.name, artist: t.artists[0] }));
    let classified: ClassifiedTrack[] = [];
    let lastfmErrors: ApiError[] = [];
    if (tracks.length > 0) {
      try {
        ({ classified, errors: lastfmErrors } = await analyzeTracks(tracks));
      } catch (err) {
        lastfmErrors = [{ method: "POST", url: "analyzeTracks", status: null, raw: String(err) }];
      }
    }

    setAnalysis({ ids: chosen.map((p) => p.id), classified, total, fetchErrors, lastfmErrors });
    setProgress(null);
    setBusy(false);
  }

  if (!me) return <p className="text-sm">Carregando perfil…</p>;

  const selectionChanged =
    analysis && (analysis.ids.length !== chosen.length || analysis.ids.some((id) => !selected.includes(id)));

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
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Playlists {playlists?.ok && `(${readable.length})`}</h2>
          <button
            className="rounded border px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-40"
            disabled={refreshing || busy}
            onClick={() => refreshPlaylists(true)}
          >
            {refreshing ? "Atualizando…" : "Atualizar lista"}
          </button>
        </div>
        {!playlists ? (
          <p className="text-sm">Carregando playlists…</p>
        ) : !playlists.ok ? (
          <RawError error={playlists} />
        ) : !me.ok ? (
          <p className="text-sm text-red-700">Sem o ID do usuário (erro acima) não dá para filtrar as playlists.</p>
        ) : (
          <PlaylistPicker
            playlists={readable.map((p) => ({ id: p.id, name: p.name }))}
            selected={selected}
            max={MAX_SELECTED}
            onToggle={toggle}
          />
        )}
        <button
          className="self-start rounded-full bg-green-600 px-5 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-40"
          disabled={busy || chosen.length === 0}
          onClick={analyze}
        >
          Analisar playlists selecionadas
        </button>
        <RateLimitNotice />
        {progress && <p className="text-sm">{progress}</p>}
      </section>

      {analysis && (
        <section className="flex flex-col gap-3 text-sm">
          <h2 className="font-semibold">Prévia por gênero</h2>
          {selectionChanged && (
            <p className="text-yellow-800">A seleção mudou desde a última análise. Clique em Analisar para atualizar.</p>
          )}
          {analysis.fetchErrors.map((e, i) => (
            <RawError key={i} error={e} />
          ))}
          <p className="text-gray-600">
            {analysis.classified.length} faixas únicas ({analysis.total - analysis.classified.length} repetidas
            removidas) · {analysis.classified.filter((t) => t.lowConfidence).length} de baixa confiança ·{" "}
            {analysis.classified.filter((t) => t.family === OTHER).length} sem família
            {analysis.lastfmErrors.length > 0 && ` · ${analysis.lastfmErrors.length} erros no Last.fm`}
          </p>
          {analysis.lastfmErrors.slice(0, 5).map((e, i) => (
            <RawError key={i} error={e} />
          ))}
          {analysis.lastfmErrors.length > 5 && <p>…e mais {analysis.lastfmErrors.length - 5} erros.</p>}
          {analysis.classified.length > 0 && (
            <Preview
              key={analysis.ids.join(",")}
              tracks={analysis.classified}
              storageKey={`preview:${[...analysis.ids].sort().join(",")}`}
              onSpotifyChanged={() => refreshPlaylists(true)}
            />
          )}
        </section>
      )}
    </div>
  );
}
