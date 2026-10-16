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
  type CSSProperties,
  type Dispatch,
} from "react";
import type { ClassifiedTrack } from "@/lib/classify";
import { OTHER } from "@/lib/genre-families";
import { initialState, reducer, type Action, type Group, type PreviewState } from "@/lib/preview-state";
import { CreatePlaylists } from "./create-playlists";
import { genreColor } from "./genre-colors";

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
  // tracks read more than once across the analyzed playlists
  duplicates: number;
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
  if (!mounted) return <p className="text-areia">Carregando prévia…</p>;
  return <PreviewEditor {...props} />;
});

function PreviewEditor({ tracks, duplicates, storageKey, createDisabledReason, onSpotifyChanged }: PreviewProps) {
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

  // summary, spectrum and the create plan lag a frame behind, so checkboxes respond first
  const deferredGroups = useDeferredValue(state.groups);
  const spectrum = useMemo(() => {
    const total = deferredGroups.reduce((n, g) => n + g.trackKeys.length, 0);
    const bands = deferredGroups
      .filter((g) => g.trackKeys.length > 0)
      .map((g) => ({ id: g.id, name: g.name, count: g.trackKeys.length, include: g.include }));
    const genres = bands.filter((b) => b.id !== OTHER).length;
    return { total, bands, genres };
  }, [deferredGroups]);
  const lowConfidence = useMemo(() => tracks.filter((t) => t.lowConfidence).length, [tracks]);
  // composition bars are relative to the largest group; a number, so cards only re-render when it changes
  const maxCount = Math.max(1, ...state.groups.map((g) => g.trackKeys.length));

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Composição da biblioteca" className="flex flex-col gap-5">
        <Spectrum bands={spectrum.bands} total={spectrum.total} />
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:flex sm:flex-wrap sm:gap-x-12">
          <Stat value={tracks.length} label="faixas únicas" />
          <Stat value={spectrum.genres} label={spectrum.genres === 1 ? "gênero" : "gêneros"} />
          <Stat value={lowConfidence} label="com baixa confiança" />
          <Stat value={duplicates} label="repetidas removidas" />
        </dl>
      </section>

      <section aria-labelledby="genres-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="genres-title" className="text-lg font-bold">
            Gêneros{" "}
            <span className="font-normal text-areia">
              {deferredGroups.filter((g) => g.include).length} de {deferredGroups.length} marcados
            </span>
          </h2>
          <button
            className="text-sm text-areia underline-offset-4 transition-colors hover:text-papel hover:underline"
            onClick={() => dispatch({ type: "reset", state: fresh })}
          >
            Desfazer edições
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {state.groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              maxCount={maxCount}
              groupOptions={groupOptions}
              byKey={byKey}
              autoMoved={state.autoMoved}
              autoMovedFamilies={g.id === OTHER ? autoMovedFamilies : NO_FAMILIES}
              dispatch={dispatch}
            />
          ))}
        </div>
      </section>

      <CreatePlaylists
        groups={deferredGroups}
        tracks={byKey}
        disabledReason={createDisabledReason}
        onDone={onSpotifyChanged}
      />
    </div>
  );
}

type Band = { id: string; name: string; count: number; include: boolean };
const LABELED = 5;
const fmt = (n: number) => n.toLocaleString("pt-BR");

// One band per group, as wide as its share. The 5 largest carry their name (and get a minimum
// width so it fits); hovering any band shows its name and count.
const Spectrum = memo(function Spectrum({ bands, total }: { bands: Band[]; total: number }) {
  // hovered band and its center in px; the tooltip sits below it (above, it would slide under the sticky header)
  const [hover, setHover] = useState<{ id: string; x: number } | null>(null);
  const labeled = useMemo(
    () => new Set([...bands].sort((a, b) => b.count - a.count).slice(0, LABELED).map((b) => b.id)),
    [bands],
  );
  const shown = bands.find((b) => b.id === hover?.id);

  return (
    <div className="relative">
      <div
        className="split-in flex h-16 gap-0.5 overflow-hidden rounded-lg sm:h-20"
        role="img"
        aria-label={bands.map((b) => `${b.name}: ${fmt(b.count)} faixas`).join(", ")}
        onMouseLeave={() => setHover(null)}
      >
        {bands.map((b) => (
          <div
            key={b.id}
            onMouseEnter={(e) => setHover({ id: b.id, x: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2 })}
            className={`flex min-w-1 flex-col justify-end overflow-hidden px-2 pb-1.5 text-cafe transition-opacity duration-150 ${
              labeled.has(b.id) ? "min-w-12 sm:min-w-20" : ""
            }`}
            style={{
              flexGrow: b.count,
              flexBasis: 0,
              background: genreColor(b.id),
              opacity: b.include ? 1 : hover?.id === b.id ? 0.6 : 0.35,
            }}
          >
            {labeled.has(b.id) && (
              <>
                <span className="num truncate text-lg sm:text-2xl">{fmt(b.count)}</span>
                <span className="truncate text-xs font-bold sm:text-sm">{b.name}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {shown && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-full z-10 mt-2 flex -translate-x-1/2 items-baseline gap-2 rounded-md border border-fio bg-grafite-2 px-3 py-1.5 text-sm whitespace-nowrap shadow-lg shadow-black/30"
          style={{ left: `clamp(6rem, ${hover?.x ?? 0}px, calc(100% - 6rem))` }}
        >
          <span className="size-2.5 flex-none self-center rounded-full" style={{ background: genreColor(shown.id) }} />
          <span className="font-bold">{shown.name}</span>
          <span className="text-areia">
            {fmt(shown.count)} {shown.count === 1 ? "faixa" : "faixas"} · {Math.round((shown.count / Math.max(1, total)) * 100)}%
            {!shown.include && " · desmarcado"}
          </span>
        </div>
      )}
    </div>
  );
});

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-sm text-areia">{label}</dt>
      <dd className="num text-5xl sm:text-6xl">{value.toLocaleString("pt-BR")}</dd>
    </div>
  );
}

// Re-renders only when its own group (or the list of group names) changes. Track rows exist
// only while the group is open, PAGE at a time.
const GroupCard = memo(function GroupCard({
  group: g,
  maxCount,
  groupOptions,
  byKey,
  autoMoved,
  autoMovedFamilies,
  dispatch,
}: {
  group: Group;
  maxCount: number;
  groupOptions: GroupOption[];
  byKey: Map<string, ClassifiedTrack>;
  autoMoved: Record<string, string>;
  autoMovedFamilies: string[];
  dispatch: Dispatch<Action>;
}) {
  const [open, setOpen] = useState(false);
  // the chevron turns on the click itself; the rows render right after that frame
  const showRows = useDeferredValue(open);
  const [limit, setLimit] = useState(PAGE);
  const [mergeTarget, setMergeTarget] = useState("");
  // the chosen target may have been merged away meanwhile
  const target = groupOptions.some((o) => o.id === mergeTarget && o.id !== g.id) ? mergeTarget : "";
  const color = genreColor(g.id);
  const low = useMemo(
    () => g.trackKeys.reduce((n, k) => n + (byKey.get(k)?.lowConfidence ? 1 : 0), 0),
    [g.trackKeys, byKey],
  );
  const count = g.trackKeys.length;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="overflow-hidden rounded-xl border border-fio bg-grafite transition-colors hover:border-areia/40"
      style={{ "--check": color, borderLeft: `6px solid ${g.include ? color : "var(--color-fio)"}` } as CSSProperties}
    >
      <summary className="flex cursor-pointer flex-col gap-2.5 p-3 pl-4">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            className="check"
            checked={g.include}
            onChange={() => dispatch({ type: "toggleInclude", groupId: g.id })}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Criar playlist de ${g.name}`}
          />
          <svg aria-hidden viewBox="0 0 16 16" className="chevron size-4 flex-none text-areia">
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-bold transition-colors hover:border-fio focus:border-areia focus:bg-cafe focus:outline-none"
            value={g.name}
            onChange={(e) => dispatch({ type: "rename", groupId: g.id, name: e.target.value })}
            onClick={(e) => e.preventDefault()}
            onKeyDown={(e) => e.key === " " && e.stopPropagation()}
            aria-label="Nome da playlist"
          />
          <span className="num text-4xl" style={{ color: g.include ? color : "var(--color-areia)" }}>
            {count.toLocaleString("pt-BR")}
          </span>
        </div>
        <div className="flex items-center gap-3 pl-9">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-cafe" aria-hidden>
            <div
              className="flex h-full justify-end rounded-full transition-[width] duration-150"
              style={{ width: `${(count / maxCount) * 100}%`, background: color }}
            >
              <div className="hatch h-full" style={{ width: `${count === 0 ? 0 : (low / count) * 100}%` }} />
            </div>
          </div>
          <span className="flex-none text-right text-sm text-areia sm:w-44">
            {low > 0 ? `${low.toLocaleString("pt-BR")} de baixa confiança` : "todas com confiança"}
          </span>
        </div>
      </summary>

      {showRows && (
        <div className="border-t border-fio">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
            <label htmlFor={`merge-${g.id}`} className="text-areia">
              Juntar este grupo com
            </label>
            <select
              id={`merge-${g.id}`}
              className="rounded-md border border-fio bg-cafe px-2 py-1"
              value={target}
              onChange={(e) => setMergeTarget(e.target.value)}
            >
              <option value="">escolha um grupo</option>
              {groupOptions
                .filter((o) => o.id !== g.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
            <button
              className="rounded-full border border-fio px-3 py-1 transition-colors hover:border-papel disabled:opacity-40 disabled:hover:border-fio"
              disabled={!target}
              onClick={() => dispatch({ type: "merge", fromId: g.id, intoId: target })}
            >
              Juntar
            </button>
          </div>

          {autoMovedFamilies.length > 0 && (
            <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-fio p-3 text-sm">
              <span className="text-areia">Gêneros com menos de 3 faixas vieram para cá:</span>
              {autoMovedFamilies.map((f) => (
                <button
                  key={f}
                  className="rounded-full border px-2.5 py-0.5 transition-colors hover:bg-grafite-2"
                  style={{ borderColor: genreColor(f), color: genreColor(f) }}
                  onClick={() => dispatch({ type: "restoreAutoMoved", family: f })}
                >
                  Recriar {f}
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
          {count > limit && (
            <button
              className="m-3 rounded-full border border-fio px-4 py-1.5 text-sm transition-colors hover:border-papel"
              onClick={() => setLimit(limit + PAGE)}
            >
              Mostrar mais {Math.min(PAGE, count - limit)} (exibindo {limit} de {count.toLocaleString("pt-BR")})
            </button>
          )}
        </div>
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
    <li
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-fio/60 px-4 py-2 ${
        t.lowConfidence ? "border-l-2 border-l-alerta" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate">
          {t.name} <span className="text-areia">de {t.artist}</span>
        </p>
        <p className="truncate text-sm text-areia">
          {t.tags.length > 0 ? t.tags.join(", ") : "nenhuma tag conhecida"}
          {autoMovedFrom && `, sugerido de ${autoMovedFrom}`}
        </p>
        {t.lowConfidence && <p className="text-sm text-alerta">Baixa confiança: {t.lowConfidence}</p>}
      </div>
      <select
        className="max-w-48 rounded-md border border-fio bg-cafe px-2 py-1 text-sm"
        value={groupId}
        onChange={(e) => dispatch({ type: "move", trackKey: t.key, toGroupId: e.target.value })}
        aria-label={`Mover ${t.name} para outro grupo`}
      >
        {groupOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id === groupId ? `${o.name} (atual)` : `Mover para ${o.name}`}
          </option>
        ))}
      </select>
    </li>
  );
});
