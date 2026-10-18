"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  dragSelection,
  filterItems,
  invert,
  rangeIds,
  setMany,
  toggleOne,
  type AnalysisInfo,
  type PickerItem,
  type QuickFilter,
} from "@/lib/selection";
import type { ItemStatus } from "./analysis-queue";

export type RowStatus = { status: ItemStatus; text: string };

const TONE: Record<ItemStatus, string> = {
  pendente: "text-areia",
  analisando: "text-papel",
  concluída: "text-ok",
  erro: "text-erro",
  cancelada: "text-areia",
};

const NO_STATUS = new Map<string, RowStatus>();
const NO_INFO = new Map<string, AnalysisInfo>();

// dragging within this distance of the list's top/bottom edge scrolls it, up to MAX_SPEED px/frame
const EDGE = 40;
const MAX_SPEED = 18;

const QUICK: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "unanalyzed", label: "Não analisadas" },
  { id: "error", label: "Com erro" },
  { id: "changed", label: "Alteradas desde a última análise" },
];

type Drag = {
  pointerId: number;
  startIndex: number;
  index: number;
  // state the pressed row took; every row dragged over gets it
  on: boolean;
  original: Set<string>;
  visible: string[];
  y: number;
  frame: number;
};

type RowHandlers = {
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
  onCheckboxChange: (id: string) => void;
  onCheckboxKeyDown: (id: string, e: React.KeyboardEvent) => void;
  onReprocess: (id: string) => void;
};

// Memoized: a click or a drag frame re-renders only the rows whose state changed. The mouse
// acts on the whole row (the checkbox ignores pointer events); the checkbox keeps keyboard
// focus, Space and screen-reader activation.
const PickerRow = memo(function PickerRow({
  id,
  name,
  checked,
  disabled,
  status,
  text,
  reprocessDisabledReason,
  handlers,
}: {
  id: string;
  name: string;
  checked: boolean;
  disabled: boolean;
  status?: ItemStatus;
  text?: string;
  reprocessDisabledReason?: string;
  handlers: RowHandlers;
}) {
  return (
    <li
      data-row-id={id}
      onPointerDown={(e) => handlers.onPointerDown(id, e)}
      onClick={(e) => handlers.onClick(id, e)}
      className={`flex items-center gap-2 rounded-md pr-2 transition-colors hover:bg-grafite-2 ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pl-2">
        <input
          type="checkbox"
          className="check pointer-events-none"
          checked={checked}
          disabled={disabled}
          onChange={() => handlers.onCheckboxChange(id)}
          onKeyDown={(e) => handlers.onCheckboxKeyDown(id, e)}
          aria-label={name}
        />
        <span className="flex min-w-0 flex-col">
          <span className={`truncate ${checked ? "" : "text-areia"}`}>{name}</span>
          {status && (
            <span className={`truncate text-xs ${TONE[status]}`}>
              {status === "analisando" && (
                <span aria-hidden className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-papel align-middle" />
              )}
              {status === "concluída" && "✓ "}
              {text}
            </span>
          )}
        </span>
      </div>
      {(status === "erro" || status === "cancelada") && (
        <button
          className="flex-none rounded-full border border-fio px-2.5 py-0.5 text-xs transition-colors hover:border-areia hover:bg-grafite-2 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!!reprocessDisabledReason}
          title={reprocessDisabledReason}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handlers.onReprocess(id);
          }}
        >
          Reprocessar
        </button>
      )}
    </li>
  );
});

export function PlaylistPicker({
  playlists,
  selected,
  disabled,
  status = NO_STATUS,
  analysis = NO_INFO,
  reprocessDisabledReason,
  onSelect,
  onReprocess,
}: {
  playlists: PickerItem[];
  selected: Set<string>;
  disabled: boolean;
  // analysis status of the playlists in the current run
  status?: Map<string, RowStatus>;
  // status and snapshot of each playlist in the current run, for the quick filters
  analysis?: Map<string, AnalysisInfo>;
  // e.g. Spotify blocked the app
  reprocessDisabledReason?: string;
  onSelect: (next: Set<string>) => void;
  onReprocess: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [quick, setQuick] = useState<QuickFilter>("all");
  const visible = useMemo(() => filterItems(playlists, deferredQuery, quick, analysis), [playlists, deferredQuery, quick, analysis]);
  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const counts = useMemo(() => {
    const byQuery = filterItems(playlists, deferredQuery, "all", analysis);
    return Object.fromEntries(QUICK.map((q) => [q.id, filterItems(byQuery, "", q.id, analysis).length])) as Record<QuickFilter, number>;
  }, [playlists, deferredQuery, analysis]);

  // the selection shown while dragging; committed to the parent on release
  const [dragSel, setDragSel] = useState<Set<string> | null>(null);
  const shown = dragSel ?? selected;

  const listRef = useRef<HTMLUListElement>(null);
  const anchor = useRef<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const lastPointer = useRef("mouse");
  // current values for the row handlers, which stay stable so memoized rows don't re-render
  const latest = useRef({ selected, visibleIds, disabled, onSelect, onReprocess });
  useEffect(() => {
    latest.current = { selected, visibleIds, disabled, onSelect, onReprocess };
  });

  // one frame of a drag: scroll near the edges, then apply the span under the pointer
  const tick = useCallback(function frame() {
    const d = drag.current;
    const list = listRef.current;
    if (!d || !list) return;
    const rect = list.getBoundingClientRect();
    if (d.y < rect.top + EDGE) list.scrollTop -= Math.ceil(MAX_SPEED * Math.min(1, (rect.top + EDGE - d.y) / EDGE));
    else if (d.y > rect.bottom - EDGE) list.scrollTop += Math.ceil(MAX_SPEED * Math.min(1, (d.y - rect.bottom + EDGE) / EDGE));
    // outside the list, the row at its nearest edge counts
    const y = Math.min(Math.max(d.y, rect.top + 2), rect.bottom - 2);
    const row = document.elementFromPoint(rect.left + 12, y)?.closest<HTMLElement>("[data-row-id]");
    const index = row ? d.visible.indexOf(row.dataset.rowId!) : -1;
    if (index !== -1 && index !== d.index) {
      d.index = index;
      setDragSel(dragSelection(d.original, d.visible, d.startIndex, index, d.on));
    }
    d.frame = requestAnimationFrame(frame);
  }, []);

  const endDrag = useCallback((commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.frame);
    drag.current = null;
    if (listRef.current?.hasPointerCapture(d.pointerId)) listRef.current.releasePointerCapture(d.pointerId);
    if (commit) latest.current.onSelect(dragSelection(d.original, d.visible, d.startIndex, d.index, d.on));
    setDragSel(null);
  }, []);

  // Esc cancels a drag
  useEffect(() => {
    if (!dragSel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && endDrag(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragSel, endDrag]);

  const handlers = useMemo<RowHandlers>(
    () => ({
      onPointerDown(id, e) {
        lastPointer.current = e.pointerType;
        const { selected, visibleIds, disabled } = latest.current;
        // touch scrolls the list; the tap is handled by onClick
        if (disabled || e.button !== 0 || e.pointerType === "touch") return;
        e.preventDefault();
        const on = !selected.has(id);
        if (e.shiftKey && anchor.current !== null) {
          latest.current.onSelect(setMany(selected, rangeIds(visibleIds, anchor.current, id), on));
          anchor.current = id;
          return;
        }
        anchor.current = id;
        const index = visibleIds.indexOf(id);
        listRef.current?.setPointerCapture(e.pointerId);
        drag.current = { pointerId: e.pointerId, startIndex: index, index, on, original: selected, visible: visibleIds, y: e.clientY, frame: 0 };
        setDragSel(dragSelection(selected, visibleIds, index, index, on));
        drag.current.frame = requestAnimationFrame(tick);
      },
      onClick(id, e) {
        // mouse and pen act on pointerdown; keyboard clicks come from the checkbox itself
        if (lastPointer.current !== "touch" || e.detail === 0 || latest.current.disabled) return;
        latest.current.onSelect(toggleOne(latest.current.selected, id));
        anchor.current = id;
      },
      onCheckboxChange(id) {
        latest.current.onSelect(toggleOne(latest.current.selected, id));
        anchor.current = id;
      },
      onCheckboxKeyDown(id, e) {
        if (e.key !== " " || !e.shiftKey) return;
        // Shift+Space: range from the last row toggled (preventDefault keeps the box from toggling too)
        e.preventDefault();
        const { selected, visibleIds } = latest.current;
        latest.current.onSelect(setMany(selected, rangeIds(visibleIds, anchor.current, id), !selected.has(id)));
        anchor.current = id;
      },
      onReprocess: (id) => latest.current.onReprocess(id),
    }),
    [tick],
  );

  const selectedCount = playlists.filter((p) => shown.has(p.id)).length;
  const allSelected = playlists.length > 0 && selectedCount === playlists.length;
  const allIds = () => playlists.map((p) => p.id);
  const link =
    "text-areia underline-offset-4 transition-colors hover:text-papel hover:underline disabled:opacity-40 disabled:hover:no-underline";

  if (playlists.length === 0) {
    return <p className="text-sm text-areia">Nenhuma playlist sua ou colaborativa encontrada.</p>;
  }

  return (
    <div className={`flex flex-col gap-1 rounded-xl border border-fio bg-grafite p-2 lg:min-h-40 lg:flex-1 ${dragSel ? "select-none" : ""}`}>
      <div className="flex flex-none flex-col gap-2 border-b border-fio px-2 pt-1 pb-2.5">
        <label className="flex cursor-pointer items-center gap-3 has-disabled:cursor-not-allowed">
          <input
            type="checkbox"
            className="check"
            checked={allSelected}
            disabled={disabled}
            onChange={() => onSelect(allSelected ? new Set() : new Set(allIds()))}
          />
          <span className="font-bold">Selecionar todas</span>
          <span className="ml-auto text-sm text-areia">
            {selectedCount} de {playlists.length}
          </span>
        </label>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <button className={link} disabled={disabled} onClick={() => onSelect(new Set(allIds()))}>
            Marcar todas
          </button>
          <button className={link} disabled={disabled} onClick={() => onSelect(new Set())}>
            Limpar seleção
          </button>
          <button className={link} disabled={disabled || visible.length === 0} onClick={() => onSelect(invert(selected, visibleIds))}>
            Inverter
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            className="min-w-0 flex-1 rounded-md border border-fio bg-cafe px-2 py-1 text-sm"
            placeholder="Buscar playlist"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar playlist por nome"
          />
          <button
            className="flex-none rounded-full border border-fio px-3 py-1 text-xs transition-colors hover:border-areia hover:bg-grafite-2 disabled:opacity-40"
            disabled={disabled || visible.length === 0}
            onClick={() => onSelect(setMany(selected, visibleIds, true))}
          >
            Marcar filtradas ({visible.length})
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros rápidos">
          {QUICK.map((q) => (
            <button
              key={q.id}
              aria-pressed={quick === q.id}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                quick === q.id ? "border-papel bg-papel font-bold text-cafe" : "border-fio text-areia hover:border-areia hover:text-papel"
              }`}
              onClick={() => setQuick(q.id)}
            >
              {q.label} {q.id !== "all" && `(${counts[q.id]})`}
            </button>
          ))}
        </div>
        <p className="text-xs text-areia">Arraste ou use Shift+clique para marcar várias.</p>
      </div>
      <ul
        ref={listRef}
        className="flex max-h-[50vh] min-h-0 flex-col overflow-y-auto lg:max-h-none lg:flex-1"
        onPointerMove={(e) => {
          if (drag.current?.pointerId === e.pointerId) drag.current.y = e.clientY;
        }}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        onLostPointerCapture={() => endDrag(true)}
      >
        {visible.length === 0 && <li className="px-2 py-3 text-sm text-areia">Nenhuma playlist com esse filtro.</li>}
        {visible.map((p) => {
          const s = status.get(p.id);
          return (
            <PickerRow
              key={p.id}
              id={p.id}
              name={p.name}
              checked={shown.has(p.id)}
              disabled={disabled}
              status={s?.status}
              text={s?.text}
              reprocessDisabledReason={reprocessDisabledReason}
              handlers={handlers}
            />
          );
        })}
      </ul>
    </div>
  );
}
