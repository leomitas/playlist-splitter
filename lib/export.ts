// "Exportar classificação (JSON)": the preview as the user left it, with each track's evidence

import type { ClassifiedTrack } from "@/lib/classify";
import { playlistName } from "@/lib/playlist-plan";
import type { Group } from "@/lib/preview-state";

export function buildExport(groups: Group[], tracks: Map<string, ClassifiedTrack>, now = new Date()) {
  return {
    app: "Playlist Splitter",
    version: 1,
    exportedAt: now.toISOString(),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      playlistName: playlistName(g),
      include: g.include,
      tracks: g.trackKeys
        .map((k) => tracks.get(k))
        .filter((t): t is ClassifiedTrack => !!t)
        .map((t) => ({
          name: t.name,
          artist: t.artist,
          uri: t.uri,
          family: t.family,
          tags: t.tags,
          lowConfidence: t.lowConfidence ?? null,
          inferredByArtist: !!t.inferredFrom,
          familyBeforeInference: t.inferredFrom?.family ?? null,
        })),
    })),
  };
}
