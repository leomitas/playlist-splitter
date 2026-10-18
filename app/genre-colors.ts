// Presentation only: one color per genre family, used for the spectrum, card bars, chips
// and counts. Same lightness (OKLCH L 0.80) so every color reads on the dark surfaces (AA).

import { OTHER } from "@/lib/genre-families";

const HUES: Record<string, [hue: number, chroma: number]> = {
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
function hashHue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function genreColor(id: string): string {
  if (id === OTHER) return "oklch(0.72 0 0)";
  const [hue, chroma] = HUES[id] ?? [hashHue(id), 0.12];
  return `oklch(0.8 ${chroma} ${hue})`;
}
