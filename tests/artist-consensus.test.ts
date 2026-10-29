import { describe, expect, it } from "vitest";
import { applyArtistConsensus, consensusFamily } from "@/lib/artist-consensus";
import { LOW_INCOHERENT } from "@/lib/classify";
import { OTHER } from "@/lib/genre-families";
import { many, track } from "./helpers";

describe("applyArtistConsensus", () => {
  it("artist with 20 tracks: 2 confident in the same family lift the 18 without family", () => {
    const tracks = [
      ...many(2, { artist: "Banda X", artistId: "x", family: "Rock", tags: ["rock"] }),
      ...many(18, { artist: "Banda X", artistId: "x" }),
    ];
    const stats = applyArtistConsensus(tracks);

    expect(tracks.every((t) => t.family === "Rock")).toBe(true);
    expect(tracks.filter((t) => t.inferredFrom)).toHaveLength(18);
    expect(tracks.slice(0, 2).every((t) => !t.inferredFrom)).toBe(true);
    expect(stats).toEqual({ inferred: 18, fromOther: 18, noLongerLow: 0 });
  });

  it("artist split 50/50 propagates nothing", () => {
    const tracks = [
      ...many(2, { artist: "Dividido", family: "Rock" }),
      ...many(2, { artist: "Dividido", family: "Pop" }),
      ...many(3, { artist: "Dividido" }),
    ];
    const stats = applyArtistConsensus(tracks);

    expect(stats.inferred).toBe(0);
    expect(tracks.filter((t) => t.family === OTHER)).toHaveLength(3);
  });

  it("never overwrites a confident track in another family", () => {
    const pop = track({ artist: "Quase", family: "Pop", tags: ["pop"] });
    const tracks = [...many(3, { artist: "Quase", family: "Rock" }), pop, track({ artist: "Quase" })];
    applyArtistConsensus(tracks);

    // 3 of 4 votes (75%) is a consensus, but the confident Pop track stays Pop
    expect(pop.family).toBe("Pop");
    expect(pop.inferredFrom).toBeUndefined();
    expect(tracks.at(-1)!.family).toBe("Rock");
  });

  it("clears low confidence when the artist agrees, and counts it", () => {
    const low = track({ artist: "Alguém", family: "Indie", lowConfidence: LOW_INCOHERENT });
    const tracks = [...many(2, { artist: "Alguém", family: "Rock" }), low];
    const stats = applyArtistConsensus(tracks);

    expect(low.family).toBe("Rock");
    expect(low.lowConfidence).toBeUndefined();
    expect(low.inferredFrom).toEqual({ family: "Indie", lowConfidence: LOW_INCOHERENT });
    expect(stats).toEqual({ inferred: 1, fromOther: 0, noLongerLow: 1 });
  });

  it("needs at least 2 votes", () => {
    const tracks = [track({ artist: "Solo", family: "Jazz" }), track({ artist: "Solo" })];
    expect(applyArtistConsensus(tracks).inferred).toBe(0);
  });

  it("low-confidence tracks don't vote", () => {
    const tracks = [
      ...many(2, { artist: "Fraco", family: "Metal", lowConfidence: "corrigido" }),
      track({ artist: "Fraco" }),
    ];
    expect(applyArtistConsensus(tracks).inferred).toBe(0);
  });

  it("groups by Spotify id, borrowing it for same-named tracks cached without one", () => {
    const tracks = [...many(2, { artist: "The Band", artistId: "abc", family: "Folk" }), track({ artist: "Band" })];
    applyArtistConsensus(tracks);
    expect(tracks[2].family).toBe("Folk");
  });

  it("homonyms (same name, different ids) are kept apart", () => {
    const tracks = [
      ...many(2, { artist: "The Band", artistId: "abc", family: "Folk" }),
      // same name, different artist id: a different artist
      track({ artist: "The Band", artistId: "other" }),
      // no id and an ambiguous name: no consensus borrowed
      track({ artist: "The Band" }),
    ];
    applyArtistConsensus(tracks);
    expect(tracks[2].family).toBe(OTHER);
    expect(tracks[3].family).toBe(OTHER);
  });
});

describe("consensusFamily", () => {
  it("applies the 65% share and the tie rule", () => {
    expect(consensusFamily(new Map([["Rock", 2]]))).toBe("Rock");
    expect(consensusFamily(new Map([["Rock", 2], ["Pop", 1]]))).toBe("Rock"); // 66.7%
    expect(consensusFamily(new Map([["Rock", 3], ["Pop", 2]]))).toBeNull(); // 60%
    expect(consensusFamily(new Map([["Rock", 2], ["Pop", 2]]))).toBeNull();
  });
});
