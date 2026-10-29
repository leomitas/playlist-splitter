import { describe, expect, it, vi } from "vitest";
import { classifyTrack, type ClassifiedTrack } from "@/lib/classify";
import { applyCountries, artistsNeedingCountry, countryKey, isFresh, NOT_FOUND_TTL_MS } from "@/lib/country";
import { FUNK_BR, FUNK_UNCERTAIN } from "@/lib/genre-families";
import type { Lookup } from "@/lib/lastfm";
import { createThrottle, lookupCountry, matchName, MB_USER_AGENT, pickCountry, searchUrl } from "@/lib/musicbrainz";
import { initialState, reducer, type PreviewState } from "@/lib/preview-state";

const tags = (...list: [string, number][]): Lookup => ({ tags: list.map(([name, count]) => ({ name, count })) });
let n = 0;
const classify = (artist: string, artistTags: Lookup) =>
  classifyTrack({ key: `k${n++}`, uri: null, name: `Song ${n}`, artist, artistTags, trackTags: null });

describe("pickCountry", () => {
  it("uses the best result when score >= 90 and the name matches exactly", () => {
    expect(pickCountry([{ name: "MC Kevin o Chris", score: 100, country: "BR" }], "MC Kevin O Chris")).toBe("BR");
    expect(pickCountry([{ name: "Prince", score: 100, country: "US" }], "Prince")).toBe("US");
  });

  it("homonym with a low score -> unknown", () => {
    expect(pickCountry([{ name: "MC Fulano", score: 72, country: "BR" }], "MC Fulano")).toBeNull();
  });

  it("high score but a different name -> unknown", () => {
    expect(pickCountry([{ name: "MC Fulano e Ciclano", score: 95, country: "BR" }], "MC Fulano")).toBeNull();
  });

  it("no result -> unknown", () => {
    expect(pickCountry([], "Ninguém")).toBeNull();
  });

  it("Takanaka: name in Japanese, the query matches an alias exactly", () => {
    const takanaka = { name: "高中正義", score: 100, country: "JP", aliases: [{ name: "Masayoshi Takanaka" }, { name: "Takanaka" }] };
    expect(pickCountry([takanaka], "Masayoshi Takanaka")).toBe("JP");
  });

  it("names in non-Latin scripts don't all normalize to the same empty string", () => {
    expect(matchName("高中正義")).not.toBe("");
    expect(pickCountry([{ name: "山下達郎", score: 100, country: "JP" }], "高中正義")).toBeNull();
  });

  it("matches ignoring case, accents, punctuation and a leading 'the'", () => {
    expect(matchName("The Funk Brothers!")).toBe(matchName("funk brothers"));
    expect(matchName("Anitta & Ludmilla")).toBe(matchName("anitta and ludmilla"));
    expect(matchName("Péricles")).toBe(matchName("pericles"));
  });

  it("result without a country -> unknown", () => {
    expect(pickCountry([{ name: "Prince", score: 100 }], "Prince")).toBeNull();
  });
});

describe("lookupCountry (fetch mocked)", () => {
  it("sends the app's User-Agent and an escaped Lucene query, and picks the country", async () => {
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ artists: [{ name: 'MC "K"', score: 100, country: "BR" }] }), { status: 200 }),
    );
    const r = await lookupCountry('MC "K"', fetchFn);
    expect(r).toEqual({ ok: true, data: { country: "BR" } });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(searchUrl('MC "K"'));
    expect(decodeURIComponent(url)).toContain('query=artist:"MC \\"K\\""');
    expect(url).toContain("fmt=json&limit=3");
    expect((init!.headers as Record<string, string>)["User-Agent"]).toBe(MB_USER_AGENT);
    expect(MB_USER_AGENT).toContain("https://github.com/leomitas/playlist-splitter");
  });

  it("a 503 (MusicBrainz rate limit) is an error for the queue to retry", async () => {
    const r = await lookupCountry("X", async () => new Response("slow down", { status: 503 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(503);
  });

  it("network failure is an error, not a crash", async () => {
    const r = await lookupCountry("X", async () => Promise.reject(new Error("offline")));
    expect(!r.ok && r.status).toBeNull();
  });
});

describe("throttle: at most 1 request per second", () => {
  it("spaces consecutive calls by the interval", async () => {
    const clock = { now: 0 };
    const waits: number[] = [];
    const throttle = createThrottle(1000, () => clock.now, async (ms) => {
      waits.push(ms);
    });
    await throttle();
    await throttle();
    await throttle();
    expect(waits).toEqual([1000, 2000]);
  });
});

describe("country cache", () => {
  it("keeps found countries and retries 'not found' after 14 days", () => {
    expect(isFresh({ country: "BR", at: 0 }, 10 * NOT_FOUND_TTL_MS)).toBe(true);
    expect(isFresh({ country: null, at: 0 }, NOT_FOUND_TTL_MS - 1)).toBe(true);
    expect(isFresh({ country: null, at: 0 }, NOT_FOUND_TTL_MS + 1)).toBe(false);
    expect(isFresh(undefined)).toBe(false);
  });
});

describe("applying countries", () => {
  const library = () => [
    classify("MC Brasil", tags(["funk", 100])),
    classify("Gringo Band", tags(["funk", 100], ["soul", 40])),
    classify("Sumido", tags(["funk", 100])),
    classify("MC Específico", tags(["funk carioca", 100])),
  ];

  it("only artists with the bare 'funk' tag (and no Funk BR tag) need a country", () => {
    expect([...artistsNeedingCountry(library()).values()]).toEqual(["MC Brasil", "Gringo Band", "Sumido"]);
  });

  it("BR -> Funk BR, US -> Funk Internacional, not found -> Funk (incerto), not looked up yet -> unchanged", () => {
    const ts = library();
    applyCountries(ts, { [countryKey("MC Brasil")]: "BR", [countryKey("Gringo Band")]: "US", [countryKey("Sumido")]: null });
    expect(ts.map((t) => t.family)).toEqual([FUNK_BR, "Funk Internacional", FUNK_UNCERTAIN, FUNK_BR]);
    expect(ts.every((t) => t.baseFamily !== undefined)).toBe(true);
  });

  it("the preview re-places tracks when the country arrives, but never a track moved by hand", () => {
    const raw = [
      ...library(),
      classify("MC Brasil", tags(["funk", 100])),
      classify("MC Brasil", tags(["funk", 100])),
      ...Array.from({ length: 3 }, () => classify("Outro", tags(["rock", 100]))),
    ];
    const before = raw.map((t) => ({ ...t }));
    applyCountries(before, {});
    let state: PreviewState = initialState(before);
    const [brasil, gringo] = before;
    // the user moves the Gringo Band track by hand
    state = reducer(state, { type: "moveMany", trackKeys: [gringo.key], toGroupId: "Outros" });

    const after = raw.map((t) => ({ ...t }) as ClassifiedTrack);
    applyCountries(after, { [countryKey("MC Brasil")]: "BR", [countryKey("Gringo Band")]: "US" });
    state = reducer(state, { type: "sync", tracks: after });
    const groupOf = (key: string) => state.groups.find((g) => g.trackKeys.includes(key))?.id;
    expect(groupOf(brasil.key)).toBe(FUNK_BR);
    expect(state.groups.find((g) => g.id === FUNK_UNCERTAIN)?.trackKeys ?? []).not.toContain(brasil.key);
    expect(groupOf(gringo.key)).toBe("Outros");
    expect(state.autoMoved[gringo.key]).toBeUndefined();
  });
});
