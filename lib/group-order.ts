// Display order of the genre cards. The order is a list of group ids computed at chosen moments
// (analysis or country lookup finished, criterion changed, "Reordenar"), never on every edit,
// so the card being edited doesn't jump.

import { FUNK_UNCERTAIN, OTHER } from "@/lib/genre-families";
import type { Group } from "@/lib/preview-state";

export type SortBy = "size" | "name" | "review";

export const SORT_OPTIONS: SortBy[] = ["size", "name", "review"];

// Always at the end, in this order, whatever the criterion
const LAST = [FUNK_UNCERTAIN, OTHER];
const lastRank = (id: string) => LAST.indexOf(id);

// nameOf / locale: the name shown (translated families) and how to compare it
export function sortGroupIds(
  groups: Group[],
  by: SortBy,
  lowCount: (g: Group) => number,
  nameOf: (g: Group) => string = (g) => g.name,
  locale = "pt-BR",
): string[] {
  const head = groups.filter((g) => lastRank(g.id) === -1);
  const tail = groups.filter((g) => lastRank(g.id) !== -1).sort((a, b) => lastRank(a.id) - lastRank(b.id));
  const byName = (a: Group, b: Group) => nameOf(a).localeCompare(nameOf(b), locale, { sensitivity: "base" });
  const size = (a: Group, b: Group) => b.trackKeys.length - a.trackKeys.length;
  const compare =
    by === "name"
      ? byName
      : by === "review"
        ? (a: Group, b: Group) => lowCount(b) - lowCount(a) || size(a, b) || byName(a, b)
        : (a: Group, b: Group) => size(a, b) || byName(a, b);
  return [...[...head].sort(compare), ...tail].map((g) => g.id);
}

// Groups in the saved order. Groups missing from it (created after the last sort) go right
// before the "last" ones; ids of groups that no longer exist are skipped.
export function orderGroups(groups: Group[], order: string[]): Group[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const placed = new Set<string>();
  const ordered: Group[] = [];
  for (const id of order) {
    const g = byId.get(id);
    if (g && !placed.has(id)) {
      ordered.push(g);
      placed.add(id);
    }
  }
  const fresh = groups.filter((g) => !placed.has(g.id));
  const firstLast = ordered.findIndex((g) => lastRank(g.id) !== -1);
  const at = firstLast === -1 ? ordered.length : firstLast;
  const freshHead = fresh.filter((g) => lastRank(g.id) === -1);
  const freshTail = fresh.filter((g) => lastRank(g.id) !== -1);
  return [...ordered.slice(0, at), ...freshHead, ...ordered.slice(at), ...freshTail];
}

const STORAGE_KEY = "preview-sort";

export function loadSortBy(): SortBy {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "name" || v === "review" || v === "size" ? v : "size";
  } catch {
    return "size";
  }
}

export function saveSortBy(by: SortBy) {
  try {
    localStorage.setItem(STORAGE_KEY, by);
  } catch {
    // storage blocked: the choice lasts for this page load
  }
}
