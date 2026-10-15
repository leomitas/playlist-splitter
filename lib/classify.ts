import { OTHER, TAG_TO_FAMILY } from "@/lib/genre-families";
import type { Lookup } from "@/lib/lastfm";

const MIN_COUNT = 20;
// Track tags only complement the artist's, so they weigh less
const TRACK_WEIGHT = 0.5;
// Coherence check needs enough classified tracks to define the selection's profile
const MIN_CLASSIFIED_FOR_COHERENCE = 5;

export type ClassifiedTrack = {
  key: string;
  // null for local files and anything that can't be added to a playlist
  uri: string | null;
  name: string;
  artist: string;
  family: string;
  // whitelisted tags that contributed, artist's first
  tags: string[];
  lowConfidence?: string;
};

export function normalizeName(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function classifyTrack(input: {
  key: string;
  uri: string | null;
  name: string;
  artist: string;
  artistTags: Lookup | null;
  trackTags: Lookup | null;
}): ClassifiedTrack {
  const weights = new Map<string, number>();
  // order of first appearance, used as tie-breaker (artist tags come first)
  const order: string[] = [];
  const tags: string[] = [];

  const add = (lookup: Lookup | null, factor: number) => {
    for (const t of lookup?.tags ?? []) {
      const family = TAG_TO_FAMILY.get(t.name);
      if (!family || t.count < MIN_COUNT) continue;
      weights.set(family, (weights.get(family) ?? 0) + t.count * factor);
      if (!order.includes(family)) order.push(family);
      if (!tags.includes(t.name)) tags.push(t.name);
    }
  };
  add(input.artistTags, 1);
  add(input.trackTags, TRACK_WEIGHT);

  let family = OTHER;
  let best = 0;
  for (const f of order) {
    const w = weights.get(f)!;
    if (w > best) {
      best = w;
      family = f;
    }
  }

  const result: ClassifiedTrack = {
    key: input.key,
    uri: input.uri,
    name: input.name,
    artist: input.artist,
    family,
    tags,
  };

  const corrected = input.artistTags?.correctedArtist ?? input.trackTags?.correctedArtist;
  if (corrected && normalizeName(corrected) !== normalizeName(input.artist)) {
    result.lowConfidence = `Last.fm corrigiu o artista para "${corrected}"`;
  }
  return result;
}

const COHERENCE_TOP = 15;
const words = (tag: string) => tag.split(/[\s-]+/).filter(Boolean);

// Flags tracks whose tags share no word with the top tags of the other artists in the
// selection (word-level, so "indie pop" matches "indie rock"); likely a homonym
export function markIncoherent(tracks: ClassifiedTrack[]) {
  const classified = tracks.filter((t) => t.family !== OTHER);
  if (classified.length < MIN_CLASSIFIED_FOR_COHERENCE) return;

  for (const t of classified) {
    if (t.lowConfidence) continue;
    const self = normalizeName(t.artist);
    const counts = new Map<string, number>();
    for (const o of classified) {
      if (normalizeName(o.artist) === self) continue;
      for (const tag of o.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const topWords = new Set(
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, COHERENCE_TOP)
        .flatMap(([tag]) => words(tag)),
    );
    if (!t.tags.some((tag) => words(tag).some((w) => topWords.has(w)))) {
      t.lowConfidence = "tags fora do padrão da seleção";
    }
  }
}
