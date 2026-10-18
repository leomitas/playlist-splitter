"use client";

// Shift+click ranges and drag-to-select over a list of on/off items (genre cards, spectrum
// bands). Items carry data-drag-id; the pressed item's new state goes to every item between it
// and the one under the pointer. Mouse and pen only: touch is left alone so the page scrolls.
// Range math comes from lib/selection.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { rangeIds } from "@/lib/selection";

const EDGE = 48;
const MAX_SPEED = 20;

type Options = {
  // item ids in display order (search applied)
  ids: string[];
  isOn: (id: string) => boolean;
  // commits a change
  apply: (ids: string[], on: boolean) => void;
  // "page": scroll the window near the viewport's top/bottom edges while dragging
  autoScroll?: "page" | "none";
};

type Drag = { pointerId: number; startId: string; currentId: string; on: boolean; ids: string[]; x: number; y: number; frame: number };

export type DragPreview = { ids: Set<string>; on: boolean } | null;

export function useDragSelect(options: Options) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const anchor = useRef<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const lastPointer = useRef("mouse");
  // the span shown while dragging; committed on release
  const [preview, setPreview] = useState<DragPreview>(null);

  const showSpan = (d: Drag) => setPreview({ ids: new Set(rangeIds(d.ids, d.startId, d.currentId)), on: d.on });

  const frame = useCallback(function tick() {
    const d = drag.current;
    if (!d) return;
    if (latest.current.autoScroll === "page") {
      if (d.y < EDGE) window.scrollBy(0, -Math.ceil(MAX_SPEED * Math.min(1, (EDGE - d.y) / EDGE)));
      else if (d.y > window.innerHeight - EDGE)
        window.scrollBy(0, Math.ceil(MAX_SPEED * Math.min(1, (d.y - window.innerHeight + EDGE) / EDGE)));
    }
    const y = Math.min(Math.max(d.y, 1), window.innerHeight - 1);
    const el = document.elementFromPoint(d.x, y)?.closest<HTMLElement>("[data-drag-id]");
    const id = el?.dataset.dragId;
    if (id && id !== d.currentId && d.ids.includes(id)) {
      d.currentId = id;
      showSpan(d);
    }
    d.frame = requestAnimationFrame(tick);
  }, []);

  const end = useCallback((commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.frame);
    drag.current = null;
    if (commit) latest.current.apply(rangeIds(d.ids, d.startId, d.currentId), d.on);
    setPreview(null);
  }, []);

  // while dragging: follow the pointer anywhere, release anywhere ends it, Esc cancels
  useEffect(() => {
    if (!preview) return;
    const move = (e: PointerEvent) => {
      if (drag.current?.pointerId !== e.pointerId) return;
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
    };
    const up = (e: PointerEvent) => drag.current?.pointerId === e.pointerId && end(true);
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [preview, end]);

  const onPointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      lastPointer.current = e.pointerType;
      if (e.button !== 0 || e.pointerType === "touch") return;
      // no text selection between clicks, no focus jump
      e.preventDefault();
      const { ids, isOn, apply } = latest.current;
      const on = !isOn(id);
      if (e.shiftKey && anchor.current !== null) {
        apply(rangeIds(ids, anchor.current, id), on);
        anchor.current = id;
        return;
      }
      anchor.current = id;
      const d: Drag = { pointerId: e.pointerId, startId: id, currentId: id, on, ids, x: e.clientX, y: e.clientY, frame: 0 };
      drag.current = d;
      showSpan(d);
      d.frame = requestAnimationFrame(frame);
    },
    [frame],
  );

  // A tap on touch screens (mouse and pen already acted on pointerdown); keyboard clicks
  // (detail 0) are handled by the control itself
  const onTap = useCallback((id: string, e: React.MouseEvent) => {
    if (lastPointer.current !== "touch" || e.detail === 0) return;
    const { isOn, apply } = latest.current;
    apply([id], !isOn(id));
    anchor.current = id;
  }, []);

  // Space / Enter on a focused item; Shift+Space selects the range from the anchor
  const onKeyToggle = useCallback((id: string, shift: boolean) => {
    const { ids, isOn, apply } = latest.current;
    apply(shift && anchor.current !== null ? rangeIds(ids, anchor.current, id) : [id], !isOn(id));
    anchor.current = id;
  }, []);

  const setAnchor = useCallback((id: string) => {
    anchor.current = id;
  }, []);

  return { preview, onPointerDown, onTap, onKeyToggle, setAnchor };
}

// State to show for an item: the drag preview wins over the real one
export const shownOn = (preview: DragPreview, id: string, actual: boolean) =>
  preview && preview.ids.has(id) ? preview.on : actual;
