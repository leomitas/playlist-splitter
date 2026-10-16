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

// True when the lookup alone is enough to give the track a family (same rule as classifyTrack)
export function hasFamilyTag(lookup: Lookup | null) {
  return !!lookup?.tags.some((t) => t.count >= MIN_COUNT && TAG_TO_FAMILY.has(t.name));
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

  // Tag counts over all tracks and per artist; "everyone but this artist" is total minus own.
  // Runs on every incremental update, so no track-by-track pairwise comparison.
  const total = new Map<string, number>();
  // ties are broken by first appearance among the *other* artists' tracks, so keep the
  // first position for the first two distinct artists using each tag
  const firsts = new Map<string, { artist: string; pos: number }[]>();
  const byArtist = new Map<string, { counts: Map<string, number>; tracks: ClassifiedTrack[] }>();
  classified.forEach((t, pos) => {
    const a = normalizeName(t.artist);
    let entry = byArtist.get(a);
    if (!entry) byArtist.set(a, (entry = { counts: new Map(), tracks: [] }));
    entry.tracks.push(t);
    t.tags.forEach((tag, i) => {
      total.set(tag, (total.get(tag) ?? 0) + 1);
      entry.counts.set(tag, (entry.counts.get(tag) ?? 0) + 1);
      const f = firsts.get(tag) ?? [];
      // position = track index, then tag index within the track
      if (f.length < 2 && !f.some((x) => x.artist === a)) firsts.set(tag, [...f, { artist: a, pos: pos * 1000 + i }]);
    });
  });

  for (const [artist, { counts, tracks: own }] of byArtist) {
    const others = [...total.entries()]
      .map(([tag, n]) => ({
        tag,
        n: n - (counts.get(tag) ?? 0),
        pos: firsts.get(tag)!.find((x) => x.artist !== artist)?.pos ?? Infinity,
      }))
      .filter((o) => o.n > 0);
    const topWords = new Set(
      others
        .sort((a, b) => b.n - a.n || a.pos - b.pos)
        .slice(0, COHERENCE_TOP)
        .flatMap((o) => words(o.tag)),
    );
    for (const t of own) {
      if (t.lowConfidence) continue;
      if (!t.tags.some((tag) => words(tag).some((w) => topWords.has(w)))) {
        t.lowConfidence = "tags fora do padrão da seleção";
      }
    }
  }
}
