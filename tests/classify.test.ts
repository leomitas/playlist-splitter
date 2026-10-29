import { describe, expect, it } from "vitest";
import { classifyTrack, hasFamilyTag, LOW_INCOHERENT, lowConfidenceReason, markIncoherent, normalizeName } from "@/lib/classify";
import { GENRE_FAMILIES, OTHER, TAG_TO_FAMILY } from "@/lib/genre-families";
import type { Lookup } from "@/lib/lastfm";

const tags = (...list: [string, number][]): Lookup => ({ tags: list.map(([name, count]) => ({ name, count })) });

const classify = (artistTags: Lookup | null, trackTags: Lookup | null = null, artist = "Artist") =>
  classifyTrack({ key: "k", uri: null, name: "Song", artist, artistTags, trackTags });

describe("tag -> family map", () => {
  it("every tag is lowercase, trimmed and in a single family", () => {
    const seen = new Map<string, string>();
    for (const [family, list] of Object.entries(GENRE_FAMILIES)) {
      for (const tag of list) {
        expect(tag, `${family}: "${tag}"`).toBe(tag.toLowerCase().trim());
        expect(seen.get(tag), `"${tag}" is in ${seen.get(tag)} and ${family}`).toBeUndefined();
        seen.set(tag, family);
      }
    }
    expect(TAG_TO_FAMILY.size).toBe(seen.size);
  });

  it("maps known tags", () => {
    expect(TAG_TO_FAMILY.get("funk carioca")).toBe("Funk BR");
    expect(TAG_TO_FAMILY.get("bossa nova")).toBe("MPB");
    expect(TAG_TO_FAMILY.get("chill")).toBeUndefined();
  });
});

describe("classifyTrack", () => {
  it("picks the family with the most weight", () => {
    const t = classify(tags(["rock", 100], ["pop", 60], ["indie", 40]));
    expect(t.family).toBe("Rock");
    expect(t.tags).toEqual(["rock", "pop", "indie"]);
  });

  it("ignores tags under the minimum count and unknown tags", () => {
    expect(classify(tags(["rock", 19], ["seen live", 100])).family).toBe(OTHER);
  });

  it("adds up tags of the same family", () => {
    // Pop 60 vs Rock 40 + 30 = 70
    expect(classify(tags(["pop", 60], ["rock", 40], ["hard rock", 30])).family).toBe("Rock");
  });

  it("track tags weigh half and only complement the artist's", () => {
    expect(classify(tags(["jazz", 50]), tags(["rock", 90])).family).toBe("Jazz");
    expect(classify(null, tags(["rock", 90])).family).toBe("Rock");
  });

  it("ties go to the family that appeared first (artist tags first)", () => {
    expect(classify(tags(["mpb", 50], ["samba", 50])).family).toBe("MPB");
  });

  it("flags Last.fm's artist correction as low confidence", () => {
    const t = classify({ ...tags(["rock", 100]), correctedArtist: "Someone Else" });
    expect(t.lowConfidence).toMatch(/Someone Else/);
    expect(classify({ ...tags(["rock", 100]), correctedArtist: "The Artist" }).lowConfidence).toBeUndefined();
  });

  it("hasFamilyTag mirrors the classification rule", () => {
    expect(hasFamilyTag(tags(["rock", 20]))).toBe(true);
    expect(hasFamilyTag(tags(["rock", 19]))).toBe(false);
    expect(hasFamilyTag(null)).toBe(false);
  });
});

describe("normalizeName", () => {
  it("drops accents, case, a leading 'the' and punctuation", () => {
    expect(normalizeName("The Beatles")).toBe(normalizeName("beatles"));
    expect(normalizeName("Simon & Garfunkel")).toBe("simonandgarfunkel");
    expect(normalizeName("Caetano Velôso")).toBe("caetanoveloso");
  });
});

describe("markIncoherent", () => {
  it("flags an artist whose tags share nothing with the rest of the selection", () => {
    const rock = (artist: string) => ({ ...classify(tags(["rock", 100], ["indie rock", 50]), null, artist), key: artist });
    const tracks = [rock("A"), rock("B"), rock("C"), rock("D"), rock("E"), { ...classify(tags(["k-pop", 100]), null, "Z"), key: "Z" }];
    markIncoherent(tracks);
    expect(tracks.at(-1)!.lowConfidence).toBe(LOW_INCOHERENT);
    expect(tracks[0].lowConfidence).toBeUndefined();
  });

  // the real case: a funk minority below the library's top 15 tags was flagged entirely
  const mainstream = () =>
    [
      ["rock", "alternative rock"], ["pop", "dance pop"], ["indie", "indie rock"], ["mpb", "bossa nova"],
      ["hip-hop", "rap"], ["electronic", "house"], ["metal", "heavy metal"], ["soul", "rnb"],
      ["punk", "pop punk"], ["folk", "americana"], ["jazz", "bebop"], ["trap", "cloud rap"],
      ["synthpop", "electropop"], ["grunge", "post-grunge"], ["techno", "trance"], ["samba", "pagode"],
    ].flatMap((tags, i) =>
      Array.from({ length: 20 }, (_, j) => ({
        ...classify({ tags: tags.map((name) => ({ name, count: 100 })) }, null, `A${i}-${j % 4}`),
        key: `m${i}-${j}`,
      })),
    );

  it("doesn't flag a minority genre shared by several artists (funk only tags)", () => {
    const funk = Array.from({ length: 8 }, (_, i) => ({ ...classify(tags(["funk", 100], ["funk carioca", 80]), null, `MC ${i % 4}`), key: `f${i}` }));
    const tracks = [...mainstream(), ...funk];
    markIncoherent(tracks);
    expect(funk.filter((t) => t.lowConfidence)).toHaveLength(0);
  });

  it("still flags a tag only one other artist uses", () => {
    const pair = [
      { ...classify(tags(["riot grrrl", 100]), null, "Solo 1"), key: "p1" },
      { ...classify(tags(["riot grrrl", 100]), null, "Solo 2"), key: "p2" },
    ];
    const tracks = [...mainstream(), ...pair];
    markIncoherent(tracks);
    expect(pair.every((t) => t.lowConfidence === LOW_INCOHERENT)).toBe(true);
  });
});

describe("lowConfidenceReason", () => {
  it("reads the codes and the Portuguese texts of older analyses", () => {
    expect(lowConfidenceReason(LOW_INCOHERENT)).toEqual({ kind: "incoherent" });
    expect(lowConfidenceReason("tags fora do padrão da seleção")).toEqual({ kind: "incoherent" });
    expect(lowConfidenceReason("corrected:Caetano Veloso")).toEqual({ kind: "corrected", artist: "Caetano Veloso" });
    expect(lowConfidenceReason('Last.fm corrigiu o artista para "Caetano Veloso"')).toEqual({
      kind: "corrected",
      artist: "Caetano Veloso",
    });
    expect(lowConfidenceReason("algo novo")).toEqual({ kind: "other", text: "algo novo" });
  });
});
