"use client";

import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
} from "react";
import type { ClassifiedTrack } from "@/lib/classify";
import { OTHER } from "@/lib/genre-families";
import { initialState, reducer, type Action, type Group, type PreviewState } from "@/lib/preview-state";
import { CreatePlaylists } from "./create-playlists";

const noopSubscribe = () => () => {};
// tracks shown per step inside an open group
const PAGE = 100;
const SAVE_DELAY_MS = 500;
const NO_FAMILIES: string[] = [];

type GroupOption = { id: string; name: string };

// Saved state belongs to one analysis run (storageKey); tracks it doesn't know yet are added
// by the effect below, tracks it knows that are gone are dropped
function loadSaved(storageKey: string, tracks: ClassifiedTrack[]): PreviewState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as PreviewState | null;
    if (!saved?.groups) return null;
    const keys = new Set(tracks.map((t) => t.key));
    return {
      groups: saved.groups.map((g) => ({ ...g, trackKeys: g.trackKeys.filter((k) => keys.has(k)) })),
      autoMoved: saved.autoMoved ?? {},
      aliases: saved.aliases ?? {},
    };
  } catch {
    return null;
  }
}

function save(storageKey: string, state: PreviewState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // storage unavailable (private mode etc.): choices just won't survive a reload
  }
}

type PreviewProps = {
  // grows while the analysis runs
  tracks: ClassifiedTrack[];
  storageKey: string;
  // set while creating playlists isn't allowed (analysis still running)
  createDisabledReason?: string;
  // called after playlists were created/updated in Spotify
  onSpotifyChanged: () => void;
};

// Memoized: changes elsewhere on the page (playlist selection, analysis progress) skip it
export const Preview = memo(function Preview(props: PreviewProps) {
  // localStorage only exists in the browser; render the editor after hydration
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return <p className="text-sm">Carregando prévia…</p>;
  return <PreviewEditor {...props} />;
});

function PreviewEditor({ tracks, storageKey, createDisabledReason, onSpotifyChanged }: PreviewProps) {
  const fresh = useMemo(() => initialState(tracks), [tracks]);
  const [state, dispatch] = useReducer(reducer, null, () => loadSaved(storageKey, tracks) ?? fresh);
  const byKey = useMemo(() => new Map(tracks.map((t) => [t.key, t])), [tracks]);

  // new playlists finished: slot their tracks in without touching the user's edits
  useEffect(() => {
    const known = new Set(state.groups.flatMap((g) => g.trackKeys));
    const added = tracks.filter((t) => !known.has(t.key));
    if (added.length > 0) dispatch({ type: "addTracks", tracks: added });
  }, [tracks, state.groups]);

  // Saved after a pause, off the click path; leaving the page flushes the pending save.
  // No flush on unmount: that happens when a new run replaces this one and drops its key.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
    const id = setTimeout(() => save(storageKey, state), SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [state, storageKey]);
  useEffect(() => {
    const flush = () => save(storageKey, latest.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [storageKey]);

  // only ids and names: toggling or moving tracks doesn't change it, so cards stay memoized
  const optionsKey = state.groups.map((g) => `${g.id}\u0000${g.name}`).join("\u0001");
  const groupOptions = useMemo<GroupOption[]>(
    () =>
      optionsKey
        .split("\u0001")
        .filter(Boolean)
        .map((s) => {
          const [id, name] = s.split("\u0000");
          return { id, name };
        }),
    [optionsKey],
  );
  const autoMovedFamilies = useMemo(() => [...new Set(Object.values(state.autoMoved))], [state.autoMoved]);

  // summary and the create plan lag a frame behind, so checkboxes respond first
  const deferredGroups = useDeferredValue(state.groups);
  const summary = useMemo(() => {
    const included = deferredGroups.filter((g) => g.include);
    return { included: included.length, tracks: included.reduce((n, g) => n + g.trackKeys.length, 0) };
  }, [deferredGroups]);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <p>
          {summary.included} de {deferredGroups.length} grupos incluídos · {summary.tracks} faixas
        </p>
        <button className="rounded border px-2 py-1 hover:bg-gray-100" onClick={() => dispatch({ type: "reset", state: fresh })}>
          Resetar
        </button>
      </div>

      {state.groups.map((g) => (
        <GroupCard
          key={g.id}
          group={g}
          groupOptions={groupOptions}
          byKey={byKey}
          autoMoved={state.autoMoved}
          autoMovedFamilies={g.id === OTHER ? autoMovedFamilies : NO_FAMILIES}
          dispatch={dispatch}
        />
      ))}

      <CreatePlaylists
        groups={deferredGroups}
        tracks={byKey}
        disabledReason={createDisabledReason}
        onDone={onSpotifyChanged}
      />
    </div>
  );
}

// Re-renders only when its own group (or the list of group names) changes. Track rows exist
// only while the group is open, PAGE at a time.
const GroupCard = memo(function GroupCard({
  group: g,
  groupOptions,
  byKey,
  autoMoved,
  autoMovedFamilies,
  dispatch,
}: {
  group: Group;
  groupOptions: GroupOption[];
  byKey: Map<string, ClassifiedTrack>;
  autoMoved: Record<string, string>;
  autoMovedFamilies: string[];
  dispatch: Dispatch<Action>;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [mergeTarget, setMergeTarget] = useState("");
  // the chosen target may have been merged away meanwhile
  const target = groupOptions.some((o) => o.id === mergeTarget && o.id !== g.id) ? mergeTarget : "";

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={`rounded border ${g.include ? "" : "opacity-50"}`}
    >
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
          value={target}
          onClick={(e) => e.preventDefault()}
          onChange={(e) => setMergeTarget(e.target.value)}
          aria-label="Juntar com"
        >
          <option value="">juntar com…</option>
          {groupOptions
            .filter((o) => o.id !== g.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
        <button
          className="rounded border px-2 hover:bg-gray-100 disabled:opacity-40"
          disabled={!target}
          onClick={(e) => {
            e.preventDefault();
            dispatch({ type: "merge", fromId: g.id, intoId: target });
          }}
        >
          Juntar
        </button>
      </summary>

      {open && (
        <>
          {autoMovedFamilies.length > 0 && (
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
            {g.trackKeys.slice(0, limit).map((k) => {
              const t = byKey.get(k);
              return t ? (
                <TrackRow
                  key={k}
                  track={t}
                  groupId={g.id}
                  autoMovedFrom={autoMoved[k]}
                  groupOptions={groupOptions}
                  dispatch={dispatch}
                />
              ) : null;
            })}
          </ul>
          {g.trackKeys.length > limit && (
            <button className="m-2 rounded border px-2 py-1 text-xs hover:bg-gray-100" onClick={() => setLimit(limit + PAGE)}>
              Mostrar mais {Math.min(PAGE, g.trackKeys.length - limit)} (exibindo {limit} de {g.trackKeys.length})
            </button>
          )}
        </>
      )}
    </details>
  );
});

const TrackRow = memo(function TrackRow({
  track: t,
  groupId,
  autoMovedFrom,
  groupOptions,
  dispatch,
}: {
  track: ClassifiedTrack;
  groupId: string;
  autoMovedFrom: string | undefined;
  groupOptions: GroupOption[];
  dispatch: Dispatch<Action>;
}) {
  return (
    <li className={`flex flex-wrap items-center gap-2 border-t px-2 py-1 ${t.lowConfidence ? "bg-yellow-100" : ""}`}>
      <div className="min-w-0 flex-1">
        <p>
          {t.name} — <span className="text-gray-600">{t.artist}</span>
        </p>
        <p className="text-xs text-gray-500">
          {t.tags.length > 0 ? t.tags.join(", ") : "nenhuma tag no mapa"}
          {autoMovedFrom && ` · sugerido de ${autoMovedFrom}`}
        </p>
        {t.lowConfidence && <p className="text-xs text-yellow-800">baixa confiança: {t.lowConfidence}</p>}
      </div>
      <select
        className="rounded border text-xs"
        value={groupId}
        onChange={(e) => dispatch({ type: "move", trackKey: t.key, toGroupId: e.target.value })}
        aria-label="Mover para"
      >
        {groupOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id === groupId ? `${o.name} (atual)` : `mover para ${o.name}`}
          </option>
        ))}
      </select>
    </li>
  );
});
