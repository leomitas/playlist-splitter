// Warnings shown before creating playlists. None of them blocks; "Outros" / "Funk (incerto)"
// ask for an extra confirmation because they hold tracks without a decided genre.

import type { ClassifiedTrack } from "@/lib/classify";
import { UNCERTAIN_FAMILIES } from "@/lib/genre-families";
import type { Group } from "@/lib/preview-state";

export const LOW_CONFIDENCE_WARN_SHARE = 0.3;

export type CreateWarnings = {
  // checked genres with more than 30% low-confidence tracks
  lowConfidence: { groupId: string; name: string; share: number }[];
  // checked groups without a decided genre
  uncertain: { groupId: string; name: string }[];
};

export function createWarnings(groups: Group[], tracks: Map<string, ClassifiedTrack>): CreateWarnings {
  const checked = groups.filter((g) => g.include && g.trackKeys.length > 0);
  return {
    lowConfidence: checked
      .map((g) => ({
        groupId: g.id,
        name: g.name,
        share: g.trackKeys.filter((k) => tracks.get(k)?.lowConfidence).length / g.trackKeys.length,
      }))
      .filter((w) => w.share > LOW_CONFIDENCE_WARN_SHARE),
    uncertain: checked.filter((g) => UNCERTAIN_FAMILIES.has(g.id)).map((g) => ({ groupId: g.id, name: g.name })),
  };
}
