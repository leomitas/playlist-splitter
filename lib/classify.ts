import { FUNK_BR, FUNK_UNCERTAIN, GENERIC_FUNK, GRINGO_FUNK, OTHER, TAG_TO_FAMILY } from "@/lib/genre-families";
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
  // first artist's Spotify id, when known
  artistId?: string;
  family: string;
  // whitelisted tags that contributed, artist's first
  tags: string[];
  lowConfidence?: string;
  // set when the artist consensus (lib/artist-consensus.ts) gave the track its family:
  // the family and low-confidence reason it had before
  inferredFrom?: { family: string; lowConfidence?: string };
  // set when the bare "funk" tag counted and no Funk BR tag did: the family weights in order
  // of appearance (FUNK_SLOT stands for "funk"), so the family can be decided again once the
  // artist's country is known (resolveFamily)
  genericFunk?: { weights: [string, number][] };
  // family from the tags alone, before country and consensus adjustments (set by the app's
  // pipeline; the preview uses it to notice tracks whose family changed)
  baseFamily?: string;
};

// Bump when classification rules change, so saved analyses can be flagged as outdated
export const CLASSIFIER_VERSION = 2;

// Placeholder family for the bare "funk" tag inside the weights
export const FUNK_SLOT = "\u0000funk";

// Where the bare "funk" tag goes, given the artist's country (null = unknown)
export const funkTarget = (country: string | null) =>
  country === "BR" ? FUNK_BR : country ? GRINGO_FUNK : FUNK_UNCERTAIN;

// Heaviest family; FUNK_SLOT counts toward `slotTarget`. Ties go to the first to appear.
function pickFamily(weights: [string, number][], slotTarget: string) {
  const merged = new Map<string, number>();
  for (const [f, w] of weights) {
    const family = f === FUNK_SLOT ? slotTarget : f;
    merged.set(family, (merged.get(family) ?? 0) + w);
  }
  let family = OTHER;
  let best = 0;
  for (const [f, w] of merged) {
    if (w > best) {
      best = w;
      family = f;
    }
  }
  return family;
}

// Family of a track once its artist's country is known; tracks without a bare "funk" decision
// keep the family they have
export function resolveFamily(t: Pick<ClassifiedTrack, "family" | "genericFunk">, country: string | null) {
  return t.genericFunk ? pickFamily(t.genericFunk.weights, funkTarget(country)) : t.family;
}

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
  artistId?: string;
  artistTags: Lookup | null;
  trackTags: Lookup | null;
}): ClassifiedTrack {
  const weights = new Map<string, number>();
  // order of first appearance, used as tie-breaker (artist tags come first)
  const order: string[] = [];
  const tags: string[] = [];

  const add = (lookup: Lookup | null, factor: number) => {
    for (const t of lookup?.tags ?? []) {
      const family = TAG_TO_FAMILY.get(t.name) ?? (t.name === GENERIC_FUNK ? FUNK_SLOT : undefined);
      if (!family || t.count < MIN_COUNT) continue;
      weights.set(family, (weights.get(family) ?? 0) + t.count * factor);
      if (!order.includes(family)) order.push(family);
      if (!tags.includes(t.name)) tags.push(t.name);
    }
  };
  add(input.artistTags, 1);
  add(input.trackTags, TRACK_WEIGHT);

  const ordered = order.map((f) => [f, weights.get(f)!] as [string, number]);
  // a Funk BR tag settles what the bare "funk" means; otherwise it waits for the country
  const brTag = weights.has(FUNK_BR);
  const genericFunk = weights.has(FUNK_SLOT) && !brTag ? { weights: ordered } : undefined;

  const result: ClassifiedTrack = {
    key: input.key,
    uri: input.uri,
    name: input.name,
    artist: input.artist,
    ...(input.artistId && { artistId: input.artistId }),
    family: pickFamily(ordered, brTag ? FUNK_BR : FUNK_UNCERTAIN),
    tags,
    ...(genericFunk && { genericFunk }),
  };

  const corrected = input.artistTags?.correctedArtist ?? input.trackTags?.correctedArtist;
  if (corrected && normalizeName(corrected) !== normalizeName(input.artist)) {
    result.lowConfidence = `Last.fm corrigiu o artista para "${corrected}"`;
  }
  return result;
}

const COHERENCE_TOP = 15;
// A word used by this many other artists is part of the selection's vocabulary even when it
// isn't in the top tags (a minority genre such as funk in a rock-heavy library)
const MIN_SUPPORTING_ARTISTS = 3;
const words = (tag: string) => tag.split(/[\s-]+/).filter(Boolean);

// Flags tracks whose tags share no word with the other artists of the selection: neither with
// their top tags nor with words that at least MIN_SUPPORTING_ARTISTS of them use (word-level,
// so "indie pop" matches "indie rock"); likely a homonym
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
  // word -> distinct artists using it
  const wordArtists = new Map<string, Set<string>>();
  classified.forEach((t, pos) => {
    const a = normalizeName(t.artist);
    let entry = byArtist.get(a);
    if (!entry) byArtist.set(a, (entry = { counts: new Map(), tracks: [] }));
    entry.tracks.push(t);
    t.tags.forEach((tag, i) => {
      for (const w of words(tag)) {
        let users = wordArtists.get(w);
        if (!users) wordArtists.set(w, (users = new Set()));
        users.add(a);
      }
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
    const supported = (w: string) => {
      const users = wordArtists.get(w);
      return !!users && users.size - (users.has(artist) ? 1 : 0) >= MIN_SUPPORTING_ARTISTS;
    };
    for (const t of own) {
      if (t.lowConfidence) continue;
      if (!t.tags.some((tag) => words(tag).some((w) => topWords.has(w) || supported(w)))) {
        t.lowConfidence = "tags fora do padrão da seleção";
      }
    }
  }
}
