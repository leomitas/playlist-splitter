// Artist countries applied to the classification: only tracks whose family depends on the bare
// "funk" tag (ClassifiedTrack.genericFunk) are affected.

import { resolveFamily, type ClassifiedTrack } from "@/lib/classify";
import { matchName } from "@/lib/musicbrainz";

// "not found" answers are cached for 14 days, then asked again; found countries are kept
export const NOT_FOUND_TTL_MS = 14 * 24 * 3600 * 1000;

export type CachedCountry = { country: string | null; at: number };

export const countryKey = (artist: string) => matchName(artist);

export const isFresh = (c: CachedCountry | undefined, now = Date.now()) =>
  !!c && (c.country !== null || now - c.at < NOT_FOUND_TTL_MS);

// Distinct artists (by countryKey) whose tracks wait for a country, with the name to search for
export function artistsNeedingCountry(tracks: ClassifiedTrack[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tracks) {
    if (!t.genericFunk || !t.artist.trim()) continue;
    const key = countryKey(t.artist);
    if (key && !out.has(key)) out.set(key, t.artist.trim());
  }
  return out;
}

// Mutates the given tracks (pass copies): records baseFamily on every track and re-decides the
// family of tracks whose artist's country is known (undefined = not looked up yet)
export function applyCountries(tracks: ClassifiedTrack[], countries: Record<string, string | null>) {
  for (const t of tracks) {
    t.baseFamily = t.family;
    if (!t.genericFunk) continue;
    const country = countries[countryKey(t.artist)];
    if (country !== undefined) t.family = resolveFamily(t, country);
  }
}
