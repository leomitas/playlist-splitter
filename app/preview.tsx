"use client";

import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import type { ClassifiedTrack } from "@/lib/classify";
import { OTHER } from "@/lib/genre-families";
import { initialState, reducer, type PreviewState } from "@/lib/preview-state";
import { CreatePlaylists } from "./create-playlists";

const noopSubscribe = () => () => {};

// Saved state only applies if it covers exactly the same tracks
function loadSaved(storageKey: string, tracks: ClassifiedTrack[]): PreviewState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as PreviewState | null;
    if (!saved?.groups) return null;
    const savedKeys = saved.groups.flatMap((g) => g.trackKeys).sort();
    const keys = tracks.map((t) => t.key).sort();
    if (savedKeys.length !== keys.length || savedKeys.some((k, i) => k !== keys[i])) return null;
    return saved;
  } catch {
    return null;
  }
}

type PreviewProps = {
  tracks: ClassifiedTrack[];
  storageKey: string;
  // called after playlists were created/updated in Spotify
  onSpotifyChanged: () => void;
};

export function Preview(props: PreviewProps) {
  // localStorage only exists in the browser; render the editor after hydration
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return <p className="text-sm">Carregando prévia…</p>;
  return <PreviewEditor {...props} />;
}

function PreviewEditor({ tracks, storageKey, onSpotifyChanged }: PreviewProps) {
  const fresh = useMemo(() => initialState(tracks), [tracks]);
  const [state, dispatch] = useReducer(reducer, null, () => loadSaved(storageKey, tracks) ?? fresh);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const byKey = useMemo(() => new Map(tracks.map((t) => [t.key, t])), [tracks]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // storage unavailable (private mode etc.): choices just won't survive a reload
    }
  }, [state, storageKey]);

  const included = state.groups.filter((g) => g.include);
  const autoMovedFamilies = [...new Set(Object.values(state.autoMoved))];

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <p>
          {included.length} de {state.groups.length} grupos incluídos ·{" "}
          {included.reduce((n, g) => n + g.trackKeys.length, 0)} faixas
        </p>
        <button className="rounded border px-2 py-1 hover:bg-gray-100" onClick={() => dispatch({ type: "reset", state: fresh })}>
          Resetar
        </button>
      </div>

      {state.groups.map((g) => (
        <details key={g.id} className={`rounded border ${g.include ? "" : "opacity-50"}`}>
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-2">
            <input
              type="checkbox"
              checked={g.include}
              onChange={() => dispatch({ type: "toggleInclude", groupId: g.id })}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Incluir ${g.name}`}
            />
            <input
              className="min-w-0 flex-1 rounded border px-1 font-semibold"
              value={g.name}
              onChange={(e) => dispatch({ type: "rename", groupId: g.id, name: e.target.value })}
              onClick={(e) => e.preventDefault()}
              onKeyDown={(e) => e.key === " " && e.stopPropagation()}
              aria-label="Nome do grupo"
            />
            <span className="text-gray-600">{g.trackKeys.length} faixas</span>
            <select
              className="rounded border"
              value={mergeTarget[g.id] ?? ""}
              onClick={(e) => e.preventDefault()}
              onChange={(e) => setMergeTarget({ ...mergeTarget, [g.id]: e.target.value })}
              aria-label="Juntar com"
            >
              <option value="">juntar com…</option>
              {state.groups
                .filter((o) => o.id !== g.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
            <button
              className="rounded border px-2 hover:bg-gray-100 disabled:opacity-40"
              disabled={!mergeTarget[g.id]}
              onClick={(e) => {
                e.preventDefault();
                dispatch({ type: "merge", fromId: g.id, intoId: mergeTarget[g.id] });
              }}
            >
              Juntar
            </button>
          </summary>

          {g.id === OTHER && autoMovedFamilies.length > 0 && (
            <div className="mx-2 mb-2 rounded bg-blue-50 p-2 text-xs">
              Grupos com menos de 3 faixas foram movidos para cá automaticamente:{" "}
              {autoMovedFamilies.map((f) => (
                <button
                  key={f}
                  className="mr-1 rounded border bg-white px-1 hover:bg-gray-100"
                  onClick={() => dispatch({ type: "restoreAutoMoved", family: f })}
                >
                  recriar {f}
                </button>
              ))}
            </div>
          )}

          <ul className="flex flex-col">
            {g.trackKeys.map((k) => {
              const t = byKey.get(k)!;
              return (
                <li key={k} className={`flex flex-wrap items-center gap-2 border-t px-2 py-1 ${t.lowConfidence ? "bg-yellow-100" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p>
                      {t.name} — <span className="text-gray-600">{t.artist}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {t.tags.length > 0 ? t.tags.join(", ") : "nenhuma tag no mapa"}
                      {state.autoMoved[k] && ` · sugerido de ${state.autoMoved[k]}`}
                    </p>
                    {t.lowConfidence && <p className="text-xs text-yellow-800">baixa confiança: {t.lowConfidence}</p>}
                  </div>
                  <select
                    className="rounded border text-xs"
                    value={g.id}
                    onChange={(e) => dispatch({ type: "move", trackKey: k, toGroupId: e.target.value })}
                    aria-label="Mover para"
                  >
                    {state.groups.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.id === g.id ? `${o.name} (atual)` : `mover para ${o.name}`}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </details>
      ))}

      <CreatePlaylists groups={state.groups} tracks={byKey} onDone={onSpotifyChanged} />
    </div>
  );
}
