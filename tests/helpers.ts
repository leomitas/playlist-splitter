import type { ClassifiedTrack } from "@/lib/classify";
import { OTHER } from "@/lib/genre-families";

let n = 0;

// A classified track; defaults to "Outros" without tags
export function track(over: Partial<ClassifiedTrack> & { artist: string }): ClassifiedTrack {
  n++;
  const key = over.key ?? `t${n}`;
  return {
    key,
    uri: `spotify:track:${key.padEnd(22, "x").slice(0, 22)}`,
    name: `Song ${n}`,
    family: OTHER,
    tags: [],
    ...over,
  };
}

export const many = (count: number, over: Partial<ClassifiedTrack> & { artist: string }) =>
  Array.from({ length: count }, () => track(over));
