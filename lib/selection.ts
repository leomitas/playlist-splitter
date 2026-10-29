// Pure selection logic for the playlist picker: filters, ranges (Shift+click / Shift+Space),
// drag-to-select and bulk actions. Selections are Sets of playlist ids; every function returns
// a new Set and leaves its input alone.

export type QuickFilter = "all" | "unanalyzed" | "error" | "changed";

export type PickerItem = { id: string; name: string; snapshotId: string };

// What the current analysis knows about a playlist
export type AnalysisInfo = { status: string; snapshotId: string };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function matchesQuick(item: PickerItem, quick: QuickFilter, info: AnalysisInfo | undefined) {
  switch (quick) {
    case "all":
      return true;
    case "unanalyzed":
      return info?.status !== "concluída";
    case "error":
      return info?.status === "erro";
    case "changed":
      // analyzed, but Spotify has another version now
      return info?.status === "concluída" && info.snapshotId !== item.snapshotId;
  }
}

export function filterItems(
  items: PickerItem[],
  query: string,
  quick: QuickFilter,
  info: Map<string, AnalysisInfo>,
): PickerItem[] {
  const q = fold(query);
  return items.filter((i) => (!q || fold(i.name).includes(q)) && matchesQuick(i, quick, info.get(i.id)));
}

// Ids between the anchor and the target, inclusive, in the visible order. Without a visible
// anchor the range is just the target.
export function rangeIds(visible: string[], anchor: string | null, target: string): string[] {
  const to = visible.indexOf(target);
  if (to === -1) return [];
  const from = anchor === null ? -1 : visible.indexOf(anchor);
  if (from === -1) return [target];
  return visible.slice(Math.min(from, to), Math.max(from, to) + 1);
}

export function setMany(selected: Set<string>, ids: Iterable<string>, on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

export const toggleOne = (selected: Set<string>, id: string) => setMany(selected, [id], !selected.has(id));

// Inverts the given ids only (e.g. the filtered list); others keep their state
export function invert(selected: Set<string>, ids: Iterable<string>): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (!next.delete(id)) next.add(id);
  }
  return next;
}

// Drag to select: every row between the one pressed and the one under the pointer gets the
// state the pressed row took (`on`); rows outside that span go back to how they were.
export function dragSelection(original: Set<string>, visible: string[], startIndex: number, currentIndex: number, on: boolean) {
  const lo = Math.max(0, Math.min(startIndex, currentIndex));
  const hi = Math.min(visible.length - 1, Math.max(startIndex, currentIndex));
  return setMany(original, visible.slice(lo, hi + 1), on);
}
