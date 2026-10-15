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

// Unedited groups (name still equals the family id) get the default suffix
export function playlistName(group: Group) {
  const name = group.name.trim();
  return name === group.id || name === "" ? `${group.id} (Playlist Splitter)` : name;
}

export function planPlaylists(groups: Group[], tracks: Map<string, ClassifiedTrack>): PlannedPlaylist[] {
  return groups
    .filter((g) => g.include && g.trackKeys.length > 0)
    .map((g) => {
      const uris = g.trackKeys
        .map((k) => tracks.get(k)?.uri)
        .filter((u): u is string => !!u && TRACK_URI.test(u));
      return { groupId: g.id, name: playlistName(g), uris, ignored: g.trackKeys.length - uris.length };
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

export function findSplitterPlaylists<
  P extends { name: string; owner: { id: string }; description?: string | null },
>(playlists: P[], myId: string, name: string): P[] {
  return playlists.filter(
    (p) =>
      p.owner.id === myId &&
      normalizeTitle(p.name) === normalizeTitle(name) &&
      decodeEntities(p.description ?? "").trim() === DESCRIPTION,
  );
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
