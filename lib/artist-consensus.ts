// Artist consensus, after classification and without any API call: an artist whose confident
// tracks clearly agree on a family lends it to that artist's unclassified or low-confidence
// tracks. Confident tracks are never changed; manual moves are protected by the preview
// (lib/preview-state.ts), which never reassigns a track the user moved.

import { normalizeName, type ClassifiedTrack } from "@/lib/classify";
import { OTHER, UNCERTAIN_FAMILIES } from "@/lib/genre-families";

export const MIN_VOTES = 2;
export const MIN_SHARE = 0.65;

export type ConsensusStats = {
  // tracks that got a family from their artist
  inferred: number;
  // of those, how many were in "Outros" and how many were low confidence
  fromOther: number;
  noLongerLow: number;
};

const isConfident = (t: ClassifiedTrack) => !UNCERTAIN_FAMILIES.has(t.family) && !t.lowConfidence;
const isCandidate = (t: ClassifiedTrack) => UNCERTAIN_FAMILIES.has(t.family) || !!t.lowConfidence;

// Spotify artist id when known; tracks cached before ids were stored borrow the id of a
// same-named track, so both land on the same artist. A name shared by two ids (homonyms)
// is ambiguous and lends nothing.
function artistKeys(tracks: ClassifiedTrack[]) {
  const idByName = new Map<string, string | null>();
  for (const t of tracks) {
    if (!t.artistId) continue;
    const name = normalizeName(t.artist);
    const seen = idByName.get(name);
    idByName.set(name, seen === undefined || seen === t.artistId ? t.artistId : null);
  }
  return (t: ClassifiedTrack) => {
    const name = normalizeName(t.artist);
    return t.artistId ?? idByName.get(name) ?? `name:${name}`;
  };
}

// Family the artist's confident tracks agree on, or null (too few votes, tie or split)
export function consensusFamily(votes: Map<string, number>): string | null {
  let total = 0;
  let best: string | null = null;
  let bestVotes = 0;
  let tie = false;
  for (const [family, n] of votes) {
    total += n;
    if (n > bestVotes) {
      best = family;
      bestVotes = n;
      tie = false;
    } else if (n === bestVotes) tie = true;
  }
  if (!best || tie || bestVotes < MIN_VOTES || bestVotes / total < MIN_SHARE) return null;
  return best;
}

// Mutates the given tracks (pass copies). Votes only come from confident tracks, so the
// result doesn't depend on the order tracks arrived in.
export function applyArtistConsensus(tracks: ClassifiedTrack[]): ConsensusStats {
  const stats: ConsensusStats = { inferred: 0, fromOther: 0, noLongerLow: 0 };
  const keyOf = artistKeys(tracks);

  const votes = new Map<string, Map<string, number>>();
  for (const t of tracks) {
    if (!t.artist.trim() || !isConfident(t)) continue;
    const k = keyOf(t);
    let v = votes.get(k);
    if (!v) votes.set(k, (v = new Map()));
    v.set(t.family, (v.get(t.family) ?? 0) + 1);
  }

  const decided = new Map<string, string | null>();
  for (const t of tracks) {
    if (!t.artist.trim() || !isCandidate(t)) continue;
    const k = keyOf(t);
    if (!decided.has(k)) decided.set(k, votes.has(k) ? consensusFamily(votes.get(k)!) : null);
    const family = decided.get(k);
    if (!family) continue;

    t.inferredFrom = { family: t.family, ...(t.lowConfidence && { lowConfidence: t.lowConfidence }) };
    stats.inferred++;
    if (t.family === OTHER) stats.fromOther++;
    if (t.lowConfidence) stats.noLongerLow++;
    t.family = family;
    delete t.lowConfidence;
  }
  return stats;
}
