// Which genre groups already have a playlist made by the app, using only the session's
// playlist list (no Spotify reads). A saved genre -> playlist id map wins (it survives renames
// and language changes); the name is the fallback, in every UI language.

import { genreName, LOCALES } from "@/lib/i18n";
import { findSplitterPlaylists, isUnnamed, NAME_SUFFIX, type PlannedPlaylist } from "@/lib/playlist-plan";
import type { Group } from "@/lib/preview-state";

// group id -> playlist id, saved per account when the app creates or updates a playlist
export type GenreTargets = Record<string, string>;

type ListedPlaylist = { id: string; name: string; owner: { id: string }; description?: string | null };

export type Target<P extends ListedPlaylist = ListedPlaylist> = {
  playlist: P;
  // playlists that matched by name (the first one is used); 1 for a saved id
  matches: number;
};

// Names the group's playlist may have: the one the user typed, or the default name in each language
export function targetNames(group: Pick<Group, "id" | "name">): string[] {
  if (!isUnnamed(group)) return [group.name.trim()];
  return [...new Set(LOCALES.map((l) => `${genreName(l, group.id)}${NAME_SUFFIX}`))];
}

export function findTarget<P extends ListedPlaylist>(
  group: Pick<Group, "id" | "name">,
  playlists: P[],
  myId: string,
  saved: GenreTargets,
): Target<P> | null {
  const savedId = saved[group.id];
  // only the user's own playlists; one deleted or unfollowed is no longer in the list
  const byId = savedId ? playlists.find((p) => p.id === savedId && p.owner.id === myId) : undefined;
  if (byId) return { playlist: byId, matches: 1 };
  const byName = [...new Set(targetNames(group).flatMap((name) => findSplitterPlaylists(playlists, myId, name)))];
  return byName.length > 0 ? { playlist: byName[0], matches: byName.length } : null;
}

export function findTargets<P extends ListedPlaylist>(
  groups: Pick<Group, "id" | "name">[],
  playlists: P[],
  myId: string,
  saved: GenreTargets,
): Record<string, Target<P> | null> {
  return Object.fromEntries(groups.map((g) => [g.id, findTarget(g, playlists, myId, saved)]));
}

export type PlanSummary = { update: number; create: number; tracks: number };

// Playlists that will receive tracks: existing ones are updated, the rest created
export function planSummary(
  planned: Pick<PlannedPlaylist, "groupId" | "uris">[],
  willUpdate: (groupId: string) => boolean,
): PlanSummary {
  const s: PlanSummary = { update: 0, create: 0, tracks: 0 };
  for (const p of planned) {
    if (p.uris.length === 0) continue;
    if (willUpdate(p.groupId)) s.update++;
    else s.create++;
    s.tracks += p.uris.length;
  }
  return s;
}

// Which wording the footer and the confirmation use
export const summaryKind = (s: PlanSummary) => (s.update === 0 ? "create" : s.create === 0 ? "update" : "mixed");
