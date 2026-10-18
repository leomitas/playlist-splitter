import { describe, expect, it } from "vitest";
import { applyArtistConsensus } from "@/lib/artist-consensus";
import { classifyTrack, resolveFamily } from "@/lib/classify";
import { FUNK_BR, FUNK_UNCERTAIN, GENRE_FAMILIES, TAG_TO_FAMILY } from "@/lib/genre-families";
import type { Lookup } from "@/lib/lastfm";

const tags = (...list: [string, number][]): Lookup => ({ tags: list.map(([name, count]) => ({ name, count })) });
let n = 0;
const classify = (artist: string, artistTags: Lookup | null, trackTags: Lookup | null = null) =>
  classifyTrack({ key: `k${n++}`, uri: null, name: `Song ${n}`, artist, artistTags, trackTags });

describe("Funk BR family", () => {
  it("maps the Brazilian funk tags and leaves the bare 'funk' unmapped", () => {
    for (const tag of [
      "brazilian funk", "funk carioca", "funk mandelao", "baile funk", "funk paulista",
      "funk ostentacao", "funk melody", "funk consciente", "automotivo",
    ]) {
      expect(TAG_TO_FAMILY.get(tag), tag).toBe(FUNK_BR);
    }
    expect(TAG_TO_FAMILY.has("funk")).toBe(false);
    expect(Object.keys(GENRE_FAMILIES)).not.toContain("Funk");
  });

  it("a specific Brazilian tag puts the track in Funk BR, with no country needed", () => {
    const t = classify("MC X", tags(["funk", 100], ["funk carioca", 60]));
    expect(t.family).toBe(FUNK_BR);
    expect(t.genericFunk).toBeUndefined();
  });

  it("other families still win when they weigh more (Ludmilla: funk carioca + pop)", () => {
    expect(classify("Ludmilla", tags(["pop", 100], ["funk carioca", 40])).family).toBe("Pop");
  });
});

describe("bare 'funk' tag and the artist's country", () => {
  it("only 'funk', country unknown -> Funk (incerto), waiting for the country", () => {
    const t = classify("MC Y", tags(["funk", 100]));
    expect(t.family).toBe(FUNK_UNCERTAIN);
    expect(t.genericFunk).toBeDefined();
  });

  it("only 'funk' + country BR -> Funk BR", () => {
    expect(resolveFamily(classify("MC Y", tags(["funk", 100])), "BR")).toBe(FUNK_BR);
  });

  it("only 'funk' + country US -> R&B/Soul (funk gringo)", () => {
    expect(resolveFamily(classify("Someone", tags(["funk", 100])), "US")).toBe("R&B/Soul");
  });

  it("not found on MusicBrainz (country null) stays Funk (incerto)", () => {
    expect(resolveFamily(classify("Unknown", tags(["funk", 100])), null)).toBe(FUNK_UNCERTAIN);
  });

  it("Prince (funk, soul, disco, pop, rock) from the US -> R&B/Soul", () => {
    const prince = classify("Prince", tags(["funk", 100], ["soul", 60], ["disco", 50], ["pop", 50], ["rock", 40]));
    expect(prince.family).toBe(FUNK_UNCERTAIN);
    expect(resolveFamily(prince, "US")).toBe("R&B/Soul");
  });

  it("Takanaka (funk, jazz) from Japan -> R&B/Soul, or Jazz when jazz dominates", () => {
    expect(resolveFamily(classify("Masayoshi Takanaka", tags(["funk", 100], ["jazz", 80])), "JP")).toBe("R&B/Soul");
    expect(resolveFamily(classify("Masayoshi Takanaka", tags(["jazz", 150], ["funk", 60])), "JP")).toBe("Jazz");
  });

  it("a rock band with a minor 'funk' tag stays Rock", () => {
    expect(resolveFamily(classify("Band", tags(["rock", 100], ["funk", 30])), "US")).toBe("Rock");
  });

  it("tracks without the bare tag ignore the country", () => {
    expect(resolveFamily(classify("Band", tags(["rock", 100])), "BR")).toBe("Rock");
  });
});

describe("consensus with Funk (incerto)", () => {
  it("uncertain tracks don't vote but receive the artist's family", () => {
    const tracks = [
      classify("MC Z", tags(["funk carioca", 100])),
      classify("MC Z", tags(["baile funk", 100])),
      classify("MC Z", tags(["funk", 100])),
    ];
    applyArtistConsensus(tracks);
    expect(tracks[2].family).toBe(FUNK_BR);
    expect(tracks[2].inferredFrom?.family).toBe(FUNK_UNCERTAIN);
  });

  it("uncertain tracks alone make no consensus", () => {
    const tracks = [classify("MC W", tags(["funk", 100])), classify("MC W", tags(["funk", 100])), classify("MC W", null)];
    expect(applyArtistConsensus(tracks).inferred).toBe(0);
  });
});
