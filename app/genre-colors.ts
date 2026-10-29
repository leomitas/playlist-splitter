// Presentation only: one color per genre family, used for the spectrum, card bars, chips
// and counts. Hue and chroma identify the genre; lightness comes from the theme tokens
// (--genre-l, --genre-c in globals.css): light colors with dark text on the dark theme, dark
// colors with light text on the light one. tests/contrast.test.ts checks every genre (AA).

import { OTHER } from "@/lib/genre-families";

export const GENRE_HUES: Record<string, [hue: number, chroma: number]> = {
  Punk: [5, 0.15],
  "Funk BR": [25, 0.14],
  "Funk Internacional": [15, 0.11],
  // muted: a group waiting for review
  "Funk (incerto)": [25, 0.05],
  Rock: [45, 0.14],
  Sertanejo: [72, 0.13],
  "Hip-hop/Rap": [95, 0.13],
  Folk: [115, 0.08],
  "Pagode/Samba": [130, 0.14],
  MPB: [150, 0.13],
  Indie: [175, 0.11],
  "Lo-fi/Bedroom": [195, 0.08],
  "Eletrônica": [215, 0.12],
  Jazz: [250, 0.11],
  Metal: [265, 0.04],
  Trap: [285, 0.12],
  Phonk: [305, 0.13],
  "R&B/Soul": [325, 0.12],
  Pop: [345, 0.13],
};

// families outside the table still get a stable color
export const UNKNOWN_CHROMA = 0.12;
export function hashHue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function genreColor(id: string): string {
  if (id === OTHER) return "oklch(var(--genre-neutral-l) 0 0)";
  const [hue, chroma] = GENRE_HUES[id] ?? [hashHue(id), UNKNOWN_CHROMA];
  return `oklch(var(--genre-l) calc(${chroma} * var(--genre-c)) ${hue})`;
}
