// Same song under different Spotify ids (album and single, two uploads of "A Dança - Ao Vivo"):
// first artist + title, normalized, must be IDENTICAL. Versions with a different title
// ("Slowed", "Remix", "Ao Vivo" vs. studio) stay distinct.

// case-, accent- and punctuation-insensitive; keeps every script
const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// null when artist or title is empty (unavailable tracks come as "" and must not collapse)
export function titleKey(name: string, artist: string | undefined): string | null {
  const a = fold(artist ?? "");
  const n = fold(name);
  return a && n ? `${a}\u0000${n}` : null;
}

// Keeps the first of each track: by key (Spotify id) and by artist + title
export function dedupe<T extends { key: string; name: string }>(
  tracks: T[],
  artistOf: (t: T) => string | undefined,
  seen: { keys: Set<string>; titles: Set<string> } = { keys: new Set(), titles: new Set() },
): T[] {
  const out: T[] = [];
  for (const t of tracks) {
    if (seen.keys.has(t.key)) continue;
    const title = titleKey(t.name, artistOf(t));
    if (title && seen.titles.has(title)) continue;
    seen.keys.add(t.key);
    if (title) seen.titles.add(title);
    out.push(t);
  }
  return out;
}
