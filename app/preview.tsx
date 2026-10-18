"use client";

import {
  memo,
  useCallback,
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
import type { ConsensusStats } from "@/lib/artist-consensus";
import type { ClassifiedTrack } from "@/lib/classify";
import { buildExport } from "@/lib/export";
import { FUNK_UNCERTAIN, OTHER } from "@/lib/genre-families";
import { loadSortBy, orderGroups, saveSortBy, SORT_LABELS, sortGroupIds, type SortBy } from "@/lib/group-order";
import {
  initialState,
  pendingSync,
  reducer,
  upgradeSaved,
  type Action,
  type Group,
  type PreviewState,
} from "@/lib/preview-state";
import { CreatePlaylists } from "./create-playlists";
import { shownOn, useDragSelect } from "./use-drag-select";
import { genreColor } from "./genre-colors";

const noopSubscribe = () => () => {};
// tracks shown per step inside an open group
const PAGE = 100;
const SAVE_DELAY_MS = 500;
const NO_FAMILIES: string[] = [];
type CardSelect = Pick<ReturnType<typeof useDragSelect>, "onPointerDown" | "onTap" | "onKeyToggle">;
const toolLink =
  "text-areia underline-offset-4 transition-colors hover:text-papel hover:underline disabled:opacity-40 disabled:hover:no-underline";

type GroupOption = { id: string; name: string };

// Saved state belongs to one analysis run (storageKey); tracks it doesn't know yet are added
// by the effect below, tracks it knows that are gone are dropped
function loadSaved(storageKey: string, tracks: ClassifiedTrack[]): PreviewState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as PreviewState | null;
    if (!saved?.groups) return null;
    const keys = new Set(tracks.map((t) => t.key));
    return upgradeSaved(
      { ...saved, groups: saved.groups.map((g) => ({ ...g, trackKeys: g.trackKeys.filter((k) => keys.has(k)) })) },
      tracks,
    );
  } catch {
    return null;
  }
}

function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
  // what the artist consensus changed in `tracks`
  consensus: ConsensusStats;
  storageKey: string;
  // set while creating playlists isn't allowed (analysis still running)
  createDisabledReason?: string;
  // called after playlists were created/updated in Spotify
  onSpotifyChanged: () => void;
  // bumped when the analysis or the country lookup finishes: the cards are sorted again
  reorderToken: number;
};

// Memoized: changes elsewhere on the page (playlist selection, analysis progress) skip it
export const Preview = memo(function Preview(props: PreviewProps) {
  // localStorage only exists in the browser; render the editor after hydration
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return <p className="text-areia">Carregando prévia…</p>;
  return <PreviewEditor {...props} />;
});

function PreviewEditor({
  tracks,
  duplicates,
  consensus,
  storageKey,
  createDisabledReason,
  onSpotifyChanged,
  reorderToken,
}: PreviewProps) {
  const fresh = useMemo(() => initialState(tracks), [tracks]);
  const [state, dispatch] = useReducer(reducer, null, () => loadSaved(storageKey, tracks) ?? fresh);
  const byKey = useMemo(() => new Map(tracks.map((t) => [t.key, t])), [tracks]);

  // Card order: a list of ids, sorted only when the analysis/lookup finishes, the criterion
  // changes or "Reordenar" is clicked (edits never move a card). Sorting happens during render
  // when one of those inputs changed, so the new order paints in the same frame.
  const [sortBy, setSortBy] = useState<SortBy>(loadSortBy);
  const [manualSort, setManualSort] = useState(0);
  const lowOf = (g: Group) => g.trackKeys.reduce((n, k) => n + (byKey.get(k)?.lowConfidence ? 1 : 0), 0);
  const sortTrigger = `${reorderToken}|${sortBy}|${manualSort}`;
  const [sorted, setSorted] = useState(() => ({ trigger: sortTrigger, order: sortGroupIds(state.groups, sortBy, lowOf) }));
  if (sorted.trigger !== sortTrigger) setSorted({ trigger: sortTrigger, order: sortGroupIds(state.groups, sortBy, lowOf) });
  const orderedGroups = useMemo(() => orderGroups(state.groups, sorted.order), [state.groups, sorted.order]);

  // genre search filters the cards (and what "Inverter" acts on)
  const [genreQuery, setGenreQuery] = useState("");
  const deferredGenreQuery = useDeferredValue(genreQuery);
  const visibleGroups = useMemo(() => {
    const q = fold(deferredGenreQuery);
    return q ? orderedGroups.filter((g) => fold(g.name).includes(q)) : orderedGroups;
  }, [orderedGroups, deferredGenreQuery]);
  // "Expandir/Recolher todos": every card follows when n changes
  const [expand, setExpand] = useState({ open: false, n: 0 });
  // undo for "Só este": the checked state before it
  const [undo, setUndo] = useState<{ name: string; include: Record<string, boolean> } | null>(null);
  const include = (action: Action) => {
    setUndo(null);
    dispatch(action);
  };

  // New playlists finished, or the artist consensus changed some families: slot the tracks in
  // without touching the user's edits (tracks moved by hand are never re-placed)
  useEffect(() => {
    if (pendingSync(state, tracks).length > 0) dispatch({ type: "sync", tracks });
  }, [tracks, state]);

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
  // what the footer will create: checked groups and their tracks
  const marked = useMemo(() => {
    const on = deferredGroups.filter((g) => g.include);
    return { groups: on.length, tracks: on.reduce((n, g) => n + g.trackKeys.length, 0) };
  }, [deferredGroups]);

  // checked state without the deferral, for controls that must answer on the click itself
  const includeNow = useMemo(() => new Map(state.groups.map((g) => [g.id, g.include])), [state.groups]);
  // Shift ranges and drags (spectrum, cards) end here
  const applyInclude = useCallback((groupIds: string[], on: boolean) => {
    setUndo(null);
    dispatch({ type: "setInclude", groupIds, on });
  }, []);

  // Shift ranges and drags on the cards' checkboxes, in the order shown (search applied)
  const visibleIds = useMemo(() => visibleGroups.map((g) => g.id), [visibleGroups]);
  const cardSelect = useDragSelect({
    ids: visibleIds,
    isOn: (id) => includeNow.get(id) ?? false,
    apply: applyInclude,
    autoScroll: "page",
  });
  // stable object: the handlers never change, so memoized cards only re-render for their own state
  const { onPointerDown: cardDown, onTap: cardTap, onKeyToggle: cardKey } = cardSelect;
  const cardHandlers = useMemo<CardSelect>(
    () => ({ onPointerDown: cardDown, onTap: cardTap, onKeyToggle: cardKey }),
    [cardDown, cardTap, cardKey],
  );

  const onlyThis = useCallback((groupId: string) => {
    const groups = latest.current.groups;
    setUndo({
      name: groups.find((g) => g.id === groupId)?.name ?? groupId,
      include: Object.fromEntries(groups.map((g) => [g.id, g.include])),
    });
    dispatch({ type: "onlyThis", groupId });
  }, []);
  const spectrum = useMemo(() => {
    const total = deferredGroups.reduce((n, g) => n + g.trackKeys.length, 0);
    // largest first, "Funk (incerto)" and "Outros" last: the cards' default order
    const bands = orderGroups(deferredGroups, sortGroupIds(deferredGroups, "size", () => 0))
      .filter((g) => g.trackKeys.length > 0)
      .map((g) => ({ id: g.id, name: g.name, count: g.trackKeys.length, include: g.include }));
    const genres = bands.filter((b) => b.id !== OTHER).length;
    return { total, bands, genres };
  }, [deferredGroups]);
  const lowConfidence = useMemo(() => tracks.filter((t) => t.lowConfidence).length, [tracks]);
  const withoutFamily = useMemo(() => tracks.filter((t) => t.family === OTHER).length, [tracks]);
  // composition bars are relative to the largest group; a number, so cards only re-render when it changes
  const maxCount = Math.max(1, ...state.groups.map((g) => g.trackKeys.length));

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Composição da biblioteca" className="flex flex-col gap-5">
        <Spectrum bands={spectrum.bands} total={spectrum.total} include={includeNow} onApply={applyInclude} />
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:flex sm:flex-wrap sm:gap-x-12">
          <Stat value={tracks.length} label="faixas únicas" />
          <Stat value={spectrum.genres} label={spectrum.genres === 1 ? "gênero" : "gêneros"} />
          <Stat value={lowConfidence} label="com baixa confiança" />
          <Stat value={duplicates} label="repetidas removidas" />
        </dl>
        {consensus.inferred > 0 && (
          <p className="text-sm text-areia">
            <span className="font-bold text-papel">Consenso por artista:</span>{" "}
            {fmt(consensus.inferred)} {consensus.inferred === 1 ? "faixa inferida" : "faixas inferidas"} pelo artista ·
            sem família {fmt(withoutFamily + consensus.fromOther)} → {fmt(withoutFamily)} (
            {fmt(consensus.fromOther)} saíram de {OTHER}) · baixa confiança {fmt(lowConfidence + consensus.noLongerLow)} →{" "}
            {fmt(lowConfidence)}
          </p>
        )}
      </section>

      <section aria-labelledby="genres-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="genres-title" className="text-lg font-bold">
            Gêneros
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-areia">
              Ordenar por
              <select
                className="rounded-md border border-fio bg-cafe px-2 py-1 text-papel"
                value={sortBy}
                onChange={(e) => {
                  const by = e.target.value as SortBy;
                  setSortBy(by);
                  saveSortBy(by);
                }}
              >
                {(Object.keys(SORT_LABELS) as SortBy[]).map((by) => (
                  <option key={by} value={by}>
                    {SORT_LABELS[by]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-sm text-areia underline-offset-4 transition-colors hover:text-papel hover:underline"
              onClick={() => setManualSort((n) => n + 1)}
              title="Aplica a ordem escolhida de novo (a lista não se reordena sozinha enquanto você edita)"
            >
              Reordenar
            </button>
            <button
              className="text-sm text-areia underline-offset-4 transition-colors hover:text-papel hover:underline"
              onClick={() =>
                downloadJson(buildExport(state.groups, byKey), `classificacao-${new Date().toISOString().slice(0, 10)}.json`)
              }
            >
              Exportar classificação (JSON)
            </button>
            <button
              className="text-sm text-areia underline-offset-4 transition-colors hover:text-papel hover:underline"
              onClick={() => dispatch({ type: "reset", state: fresh })}
            >
              Desfazer edições
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-fio bg-grafite/60 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="font-bold" aria-live="polite">
              {fmt(marked.groups)} de {fmt(deferredGroups.length)} marcados{" "}
              <span className="font-normal text-areia">· {fmt(marked.tracks)} faixas</span>
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <button className={toolLink} onClick={() => include({ type: "setInclude", groupIds: "all", on: true })}>
                Marcar todos
              </button>
              <button className={toolLink} onClick={() => include({ type: "setInclude", groupIds: "all", on: false })}>
                Limpar
              </button>
              <button
                className={toolLink}
                disabled={visibleGroups.length === 0}
                onClick={() => include({ type: "invertInclude", groupIds: visibleGroups.map((g) => g.id) })}
                title={genreQuery ? "Inverte só os gêneros que aparecem na busca" : undefined}
              >
                Inverter
              </button>
              <button
                className={toolLink}
                onClick={() => include({ type: "includeRecommended" })}
                title={`Todos, exceto ${OTHER} e ${FUNK_UNCERTAIN}`}
              >
                Marcar recomendados
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <input
              type="search"
              className="min-w-0 flex-1 rounded-md border border-fio bg-cafe px-2 py-1 sm:max-w-64"
              placeholder="Buscar gênero"
              value={genreQuery}
              onChange={(e) => setGenreQuery(e.target.value)}
              aria-label="Buscar gênero pelo nome"
            />
            <button className={toolLink} onClick={() => setExpand((x) => ({ open: true, n: x.n + 1 }))}>
              Expandir todos
            </button>
            <button className={toolLink} onClick={() => setExpand((x) => ({ open: false, n: x.n + 1 }))}>
              Recolher todos
            </button>
          </div>
          {undo && (
            <p className="text-areia" role="status">
              Só <span className="font-bold text-papel">{undo.name}</span> ficou marcado.{" "}
              <button
                className="text-papel underline underline-offset-4"
                onClick={() => {
                  dispatch({ type: "restoreInclude", include: undo.include });
                  setUndo(null);
                }}
              >
                Desfazer
              </button>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {visibleGroups.length === 0 && <p className="text-sm text-areia">Nenhum gênero com esse nome.</p>}
          {visibleGroups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              shownInclude={shownOn(cardSelect.preview, g.id, g.include)}
              select={cardHandlers}
              expand={expand}
              onOnly={onlyThis}
              maxCount={maxCount}
              groupOptions={groupOptions}
              byKey={byKey}
              autoMoved={state.autoMoved}
              autoMovedFamilies={g.id === OTHER ? autoMovedFamilies : NO_FAMILIES}
              dispatch={dispatch}
            />
          ))}
          {lowConfidence > 0 && (
            <LowConfidenceCard
              count={lowConfidence}
              groups={state.groups}
              groupOptions={groupOptions}
              byKey={byKey}
              autoMoved={state.autoMoved}
              dispatch={dispatch}
            />
          )}
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
const Spectrum = memo(function Spectrum({
  bands,
  total,
  include,
  onApply,
}: {
  bands: Band[];
  total: number;
  // checked state right now (bands come from deferred groups and lag a frame)
  include: Map<string, boolean>;
  onApply: (ids: string[], on: boolean) => void;
}) {
  // hovered/focused band and its center in px; the tooltip sits below it (above, it would slide under the sticky header)
  const [hover, setHover] = useState<{ id: string; x: number } | null>(null);
  const labeled = useMemo(
    () => new Set([...bands].sort((a, b) => b.count - a.count).slice(0, LABELED).map((b) => b.id)),
    [bands],
  );
  const ids = useMemo(() => bands.map((b) => b.id), [bands]);
  const isOn = (id: string) => include.get(id) ?? false;
  const select = useDragSelect({ ids, isOn, apply: onApply, axis: "x" });
  const shown = bands.find((b) => b.id === hover?.id);
  const point = (e: { currentTarget: HTMLElement }, id: string) =>
    setHover({ id, x: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2 });

  return (
    <div className="relative">
      <div
        className={`split-in flex h-16 gap-0.5 overflow-hidden rounded-lg sm:h-20 ${select.preview ? "select-none" : ""}`}
        role="group"
        aria-label="Espectro de gêneros: cada faixa marca ou desmarca o gênero"
        onMouseLeave={() => setHover(null)}
      >
        {bands.map((b) => {
          const on = shownOn(select.preview, b.id, isOn(b.id));
          const color = genreColor(b.id);
          const percent = Math.round((b.count / Math.max(1, total)) * 100);
          return (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${b.name}: ${fmt(b.count)} ${b.count === 1 ? "faixa" : "faixas"}, ${percent}%, ${on ? "marcado" : "desmarcado"}`}
              data-drag-id={b.id}
              onPointerDown={(e) => select.onPointerDown(b.id, e)}
              onClick={(e) => select.onTap(b.id, e)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                select.onKeyToggle(b.id, e.key === " " && e.shiftKey);
              }}
              onMouseEnter={(e) => point(e, b.id)}
              onFocus={(e) => point(e, b.id)}
              onBlur={() => setHover(null)}
              className={`flex min-w-3 cursor-pointer flex-col justify-end overflow-hidden px-2 pb-1.5 transition-colors duration-150 focus-visible:outline-offset-[-3px] ${
                labeled.has(b.id) ? "min-w-12 sm:min-w-20" : ""
              } ${on ? "text-cafe" : "text-papel"}`}
              style={{
                flexGrow: b.count,
                flexBasis: 0,
                // unchecked: dimmed background, light text that stays readable
                background: on
                  ? color
                  : `color-mix(in oklch, ${color} ${hover?.id === b.id ? 45 : 28}%, var(--color-cafe))`,
              }}
            >
              {labeled.has(b.id) && (
                <>
                  <span className="num truncate text-lg sm:text-2xl">{fmt(b.count)}</span>
                  <span className="truncate text-xs font-bold sm:text-sm">{b.name}</span>
                </>
              )}
            </div>
          );
        })}
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
            {fmt(shown.count)} {shown.count === 1 ? "faixa" : "faixas"} · {Math.round((shown.count / Math.max(1, total)) * 100)}% ·{" "}
            {shownOn(select.preview, shown.id, isOn(shown.id)) ? "marcado" : "desmarcado"}
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
  shownInclude,
  select,
  expand,
  onOnly,
  maxCount,
  groupOptions,
  byKey,
  autoMoved,
  autoMovedFamilies,
  dispatch,
}: {
  group: Group;
  // checked state to show (a drag in progress previews here before committing)
  shownInclude: boolean;
  select: CardSelect;
  // "Expandir/Recolher todos": applied when n changes
  expand: { open: boolean; n: number };
  onOnly: (groupId: string) => void;
  maxCount: number;
  groupOptions: GroupOption[];
  byKey: Map<string, ClassifiedTrack>;
  autoMoved: Record<string, string>;
  autoMovedFamilies: string[];
  dispatch: Dispatch<Action>;
}) {
  const [open, setOpen] = useState(expand.open);
  const [expandSeen, setExpandSeen] = useState(expand.n);
  if (expandSeen !== expand.n) {
    setExpandSeen(expand.n);
    setOpen(expand.open);
  }
  // the chevron turns on the click itself; the rows render right after that frame
  const showRows = useDeferredValue(open);
  const [mergeTarget, setMergeTarget] = useState("");
  // the chosen target may have been merged away meanwhile
  const target = groupOptions.some((o) => o.id === mergeTarget && o.id !== g.id) ? mergeTarget : "";
  const color = genreColor(g.id);
  const low = useMemo(
    () => g.trackKeys.reduce((n, k) => n + (byKey.get(k)?.lowConfidence ? 1 : 0), 0),
    [g.trackKeys, byKey],
  );
  const count = g.trackKeys.length;
  const entries = useMemo(() => (showRows ? g.trackKeys.map((key) => ({ key, groupId: g.id })) : NO_ENTRIES), [showRows, g.trackKeys, g.id]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="overflow-hidden rounded-xl border border-fio bg-grafite transition-colors hover:border-areia/40"
      style={{ "--check": color, borderLeft: `6px solid ${g.include ? color : "var(--color-fio)"}` } as CSSProperties}
    >
      <summary
        className="flex cursor-pointer flex-col gap-2.5 p-3 pl-4 select-none"
        // Shift+click elsewhere on the header must not select the text between two clicks
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      >
        <div className="flex items-center gap-3">
          {/* The mouse acts on this wrapper (pointerdown: toggle, Shift range, drag); the
              checkbox ignores pointer events but keeps focus, Space and Shift+Space */}
          <span
            data-drag-id={g.id}
            className="flex flex-none cursor-pointer"
            onPointerDown={(e) => select.onPointerDown(g.id, e)}
            onClick={(e) => {
              // inside <summary>: don't open/close the card
              e.preventDefault();
              e.stopPropagation();
              select.onTap(g.id, e);
            }}
          >
            <input
              type="checkbox"
              className="check pointer-events-none"
              checked={shownInclude}
              onChange={() => select.onKeyToggle(g.id, false)}
              onKeyDown={(e) => {
                if (e.key !== " " || !e.shiftKey) return;
                // Shift+Space: range; preventDefault keeps the box from toggling on its own
                e.preventDefault();
                select.onKeyToggle(g.id, true);
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Criar playlist de ${g.name}`}
            />
          </span>
          <svg aria-hidden viewBox="0 0 16 16" className="chevron size-4 flex-none text-areia">
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-bold transition-colors select-text hover:border-fio focus:border-areia focus:bg-cafe focus:outline-none"
            value={g.name}
            onChange={(e) => dispatch({ type: "rename", groupId: g.id, name: e.target.value })}
            onClick={(e) => e.preventDefault()}
            onKeyDown={(e) => e.key === " " && e.stopPropagation()}
            aria-label="Nome da playlist"
          />
          <button
            type="button"
            className="flex-none rounded-full border border-fio px-2.5 py-0.5 text-xs text-areia transition-colors hover:border-areia hover:text-papel"
            onClick={(e) => {
              // inside <summary>: don't open/close the card
              e.preventDefault();
              e.stopPropagation();
              onOnly(g.id);
            }}
            aria-label={`Marcar só ${g.name}`}
            title="Marca só este gênero e desmarca os outros"
          >
            Só este
          </button>
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

          <ReviewList
            entries={entries}
            currentGroupId={g.id}
            byKey={byKey}
            groupOptions={groupOptions}
            autoMoved={autoMoved}
            dispatch={dispatch}
          />
        </div>
      )}
    </details>
  );
});

type Entry = { key: string; groupId: string };
const NO_ENTRIES: Entry[] = [];

// Every low-confidence track of every group in one list, with the same review tools
const LowConfidenceCard = memo(function LowConfidenceCard({
  count,
  groups,
  groupOptions,
  byKey,
  autoMoved,
  dispatch,
}: {
  count: number;
  groups: Group[];
  groupOptions: GroupOption[];
  byKey: Map<string, ClassifiedTrack>;
  autoMoved: Record<string, string>;
  dispatch: Dispatch<Action>;
}) {
  const [open, setOpen] = useState(false);
  const showRows = useDeferredValue(open);
  // built only while open: closed, a move elsewhere costs nothing here
  const entries = useMemo(
    () =>
      showRows
        ? groups.flatMap((g) => g.trackKeys.filter((k) => byKey.get(k)?.lowConfidence).map((key) => ({ key, groupId: g.id })))
        : NO_ENTRIES,
    [showRows, groups, byKey],
  );
  const groupName = useMemo(() => new Map(groupOptions.map((o) => [o.id, o.name])), [groupOptions]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="overflow-hidden rounded-xl border border-dashed border-alerta/50 bg-grafite transition-colors hover:border-alerta"
      style={{ "--check": "var(--color-alerta)" } as CSSProperties}
    >
      <summary className="flex cursor-pointer items-center gap-3 p-3 pl-4">
        <svg aria-hidden viewBox="0 0 16 16" className="chevron size-4 flex-none text-areia">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="flex-1 text-lg font-bold">Revisar baixa confiança de todos os grupos</span>
        <span className="num text-4xl text-alerta">{fmt(count)}</span>
      </summary>
      {showRows && (
        <div className="border-t border-fio">
          <ReviewList
            entries={entries}
            groupName={groupName}
            byKey={byKey}
            groupOptions={groupOptions}
            autoMoved={autoMoved}
            dispatch={dispatch}
            onlyLow
          />
        </div>
      )}
    </details>
  );
});

type Filter = "all" | "low" | "inferred";
const NEW_GROUP = "\u0000new";
// case- and accent-insensitive; keeps non-Latin scripts searchable
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const folded = new WeakMap<ClassifiedTrack, string>();
function searchable(t: ClassifiedTrack) {
  let s = folded.get(t);
  if (s === undefined) folded.set(t, (s = fold(`${t.name} ${t.artist}`)));
  return s;
}

// Search, filters, per-track checkboxes and a bulk "move" bar over a list of tracks
// (one group's, or the low-confidence ones of every group). Rows render PAGE at a time.
const ReviewList = memo(function ReviewList({
  entries,
  currentGroupId,
  groupName,
  byKey,
  groupOptions,
  autoMoved,
  dispatch,
  onlyLow,
}: {
  entries: Entry[];
  // set inside a group card: that group is left out of the "move to" options
  currentGroupId?: string;
  // set in the combined list: each row shows the group it's in
  groupName?: Map<string, string>;
  byKey: Map<string, ClassifiedTrack>;
  groupOptions: GroupOption[];
  autoMoved: Record<string, string>;
  dispatch: Dispatch<Action>;
  onlyLow?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  // typing stays responsive; the list follows a frame later
  const deferredQuery = useDeferredValue(query);

  const counts = useMemo(() => {
    let low = 0;
    let inferred = 0;
    for (const e of entries) {
      const t = byKey.get(e.key);
      if (t?.lowConfidence) low++;
      if (t?.inferredFrom) inferred++;
    }
    return { low, inferred };
  }, [entries, byKey]);

  const filtered = useMemo(() => {
    const q = fold(deferredQuery);
    return entries.filter((e) => {
      const t = byKey.get(e.key);
      if (!t) return false;
      if (filter === "low" && !t.lowConfidence) return false;
      if (filter === "inferred" && !t.inferredFrom) return false;
      return !q || searchable(t).includes(q);
    });
  }, [entries, byKey, filter, deferredQuery]);

  // only what's still listed counts as selected (moved tracks leave the list by themselves)
  const listed = useMemo(() => new Set(filtered.map((e) => e.key)), [filtered]);
  const chosen = useMemo(() => [...selected].filter((k) => listed.has(k)), [selected, listed]);
  const allChosen = filtered.length > 0 && chosen.length === filtered.length;

  const toggle = useCallback(
    (key: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );

  const done = () => {
    setSelected(new Set());
    setTarget("");
    setNewName("");
  };
  const moveTo = (toGroupId: string) => {
    dispatch({ type: "moveMany", trackKeys: chosen, toGroupId });
    done();
  };
  const apply = () => {
    if (target === NEW_GROUP) dispatch({ type: "createGroup", name: newName, trackKeys: chosen });
    else dispatch({ type: "moveMany", trackKeys: chosen, toGroupId: target });
    done();
  };
  const targets = groupOptions.filter((o) => o.id !== currentGroupId);
  const field = "rounded-md border border-fio bg-cafe px-2 py-1";
  const pill =
    "rounded-full border border-fio px-3 py-1 transition-colors hover:border-papel disabled:opacity-40 disabled:hover:border-fio";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
        <input
          type="search"
          className={`${field} min-w-0 flex-1 sm:max-w-64`}
          placeholder="Buscar artista ou faixa"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          aria-label="Buscar artista ou faixa"
        />
        {!onlyLow && (
          <select
            className={field}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as Filter);
              setLimit(PAGE);
            }}
            aria-label="Filtrar faixas"
          >
            <option value="all">Todas</option>
            <option value="low">Só baixa confiança ({fmt(counts.low)})</option>
            <option value="inferred">Só inferidas pelo artista ({fmt(counts.inferred)})</option>
          </select>
        )}
        <label className="flex cursor-pointer items-center gap-2 has-disabled:cursor-not-allowed">
          <input
            type="checkbox"
            className="check"
            checked={allChosen}
            disabled={filtered.length === 0}
            onChange={() => setSelected(allChosen ? new Set() : new Set(filtered.map((e) => e.key)))}
          />
          Selecionar todas as filtradas ({fmt(filtered.length)})
        </label>
      </div>

      {chosen.length > 0 && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-y border-fio bg-grafite-2 px-4 py-2 text-sm"
          role="toolbar"
          aria-label="Ações com as faixas selecionadas"
        >
          <span className="font-bold">
            {fmt(chosen.length)} {chosen.length === 1 ? "selecionada" : "selecionadas"}
          </span>
          <select className={field} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Mover para">
            <option value="">Mover para…</option>
            {targets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            <option value={NEW_GROUP}>Novo grupo…</option>
          </select>
          {target === NEW_GROUP && (
            <input
              className={field}
              placeholder="Nome do grupo novo"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newName.trim() && apply()}
              aria-label="Nome do grupo novo"
              autoFocus
            />
          )}
          <button className={pill} disabled={!target || (target === NEW_GROUP && !newName.trim())} onClick={apply}>
            Mover
          </button>
          {currentGroupId !== OTHER && (
            <button className={pill} onClick={() => moveTo(OTHER)}>
              Mover para {OTHER}
            </button>
          )}
          <button className="ml-auto text-areia underline-offset-4 hover:text-papel hover:underline" onClick={done}>
            Limpar seleção
          </button>
        </div>
      )}

      {filtered.length === 0 && <p className="px-4 pb-3 text-sm text-areia">Nenhuma faixa com esse filtro.</p>}
      <ul className="flex flex-col">
        {filtered.slice(0, limit).map(({ key, groupId }) => {
          const t = byKey.get(key);
          return t ? (
            <TrackRow
              key={key}
              track={t}
              groupId={groupId}
              groupLabel={groupName?.get(groupId)}
              autoMovedFrom={autoMoved[key]}
              groupOptions={groupOptions}
              selected={selected.has(key)}
              onSelect={toggle}
              dispatch={dispatch}
            />
          ) : null;
        })}
      </ul>
      {filtered.length > limit && (
        <button
          className="m-3 rounded-full border border-fio px-4 py-1.5 text-sm transition-colors hover:border-papel"
          onClick={() => setLimit(limit + PAGE)}
        >
          Mostrar mais {Math.min(PAGE, filtered.length - limit)} (exibindo {limit} de {fmt(filtered.length)})
        </button>
      )}
    </>
  );
});

const TrackRow = memo(function TrackRow({
  track: t,
  groupId,
  groupLabel,
  autoMovedFrom,
  groupOptions,
  selected,
  onSelect,
  dispatch,
}: {
  track: ClassifiedTrack;
  groupId: string;
  groupLabel?: string;
  autoMovedFrom: string | undefined;
  groupOptions: GroupOption[];
  selected: boolean;
  onSelect: (key: string) => void;
  dispatch: Dispatch<Action>;
}) {
  return (
    <li
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-fio/60 px-4 py-2 ${
        t.lowConfidence ? "border-l-2 border-l-alerta" : ""
      }`}
    >
      <input
        type="checkbox"
        className="check"
        checked={selected}
        onChange={() => onSelect(t.key)}
        aria-label={`Selecionar ${t.name}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          {t.name} <span className="text-areia">de {t.artist}</span>
          {groupLabel && <span className="text-areia"> · em {groupLabel}</span>}
        </p>
        <p className="truncate text-sm text-areia">
          {t.tags.length > 0 ? t.tags.join(", ") : "nenhuma tag conhecida"}
          {autoMovedFrom && `, sugerido de ${autoMovedFrom}`}
          {t.inferredFrom && (
            <span
              className="ml-2 rounded-full border border-fio px-2 py-px text-xs"
              title={`Antes: ${t.inferredFrom.family}${t.inferredFrom.lowConfidence ? ` (baixa confiança: ${t.inferredFrom.lowConfidence})` : ""}`}
            >
              inferida pelo artista
            </span>
          )}
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
