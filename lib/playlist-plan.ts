import type { ClassifiedTrack } from "@/lib/classify";
import type { Group } from "@/lib/preview-state";

export const BATCH_SIZE = 100;
export const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;

export type PlannedPlaylist = {
  groupId: string;
  name: string;
  uris: string[];
  ignored: number;
};

export const NAME_SUFFIX = " (Playlist Splitter)";

// Unedited groups (name still equals the family id) get the family's display name (`label`,
// translated by the UI) and the default suffix
export const isUnnamed = (group: Pick<Group, "id" | "name">) => group.name.trim() === group.id || group.name.trim() === "";

export function playlistName(group: Pick<Group, "id" | "name">, label: (familyId: string) => string = (id) => id) {
  return isUnnamed(group) ? `${label(group.id)}${NAME_SUFFIX}` : group.name.trim();
}

export function planPlaylists(
  groups: Group[],
  tracks: Map<string, ClassifiedTrack>,
  label?: (familyId: string) => string,
): PlannedPlaylist[] {
  return groups
    .filter((g) => g.include && g.trackKeys.length > 0)
    .map((g) => {
      const uris = g.trackKeys
        .map((k) => tracks.get(k)?.uri)
        .filter((u): u is string => !!u && TRACK_URI.test(u));
      return { groupId: g.id, name: playlistName(g, label), uris, ignored: g.trackKeys.length - uris.length };
    });
}

export const DESCRIPTION = "Criada pelo Playlist Splitter";

const normalizeTitle = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// The API returns descriptions HTML-escaped
function decodeEntities(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Playlists this app created (owned by the user, with our description)
export function isSplitterPlaylist(p: { owner: { id: string }; description?: string | null }, myId: string) {
  return p.owner.id === myId && decodeEntities(p.description ?? "").trim() === DESCRIPTION;
}

export function findSplitterPlaylists<
  P extends { name: string; owner: { id: string }; description?: string | null },
>(playlists: P[], myId: string, name: string): P[] {
  return playlists.filter((p) => isSplitterPlaylist(p, myId) && normalizeTitle(p.name) === normalizeTitle(name));
}

// Keeps the group's order; existing tracks are never touched, only missing ones are added
export function missingUris(groupUris: string[], existing: string[]): string[] {
  const have = new Set(existing);
  return groupUris.filter((u) => !have.has(u));
}

export function chunk<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
