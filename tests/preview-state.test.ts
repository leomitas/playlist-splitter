import { describe, expect, it } from "vitest";
import { applyArtistConsensus } from "@/lib/artist-consensus";
import type { ClassifiedTrack } from "@/lib/classify";
import { FUNK_BR, FUNK_UNCERTAIN, OTHER } from "@/lib/genre-families";
import { planPlaylists } from "@/lib/playlist-plan";
import { hasTracks, initialState, pendingSync, reducer, upgradeSaved, type PreviewState } from "@/lib/preview-state";
import { many, track } from "./helpers";

const groupOf = (s: PreviewState, key: string) => s.groups.find((g) => g.trackKeys.includes(key))?.id;
const copies = (ts: ClassifiedTrack[]) => ts.map((t) => ({ ...t }));

// Tracks without consensus yet: one confident Rock track of artist A, plus unclassified ones
function base() {
  return [
    ...many(3, { artist: "Outra", family: "Rock" }),
    track({ key: "a1", artist: "A", family: "Rock" }),
    track({ key: "a2", artist: "A" }),
    track({ key: "a3", artist: "A" }),
  ];
}

describe("preview and the artist consensus", () => {
  it("re-places inferred tracks, but never one moved by hand", () => {
    let state = initialState(base());
    expect(groupOf(state, "a2")).toBe(OTHER);

    // the user moves a3 by hand to a group of their own
    state = reducer(state, { type: "createGroup", name: "Minhas", trackKeys: ["a3"] });
    const mine = groupOf(state, "a3")!;
    expect(mine).toMatch(/^custom:/);

    // a second confident track of A arrives: A now has a consensus (Rock)
    const later = copies([...base(), track({ key: "a4", artist: "A", family: "Rock" })]);
    applyArtistConsensus(later);
    expect(later.find((t) => t.key === "a3")!.family).toBe("Rock");

    state = reducer(state, { type: "sync", tracks: later });
    expect(groupOf(state, "a2")).toBe("Rock");
    expect(groupOf(state, "a4")).toBe("Rock");
    expect(groupOf(state, "a3")).toBe(mine);
    expect(pendingSync(state, later)).toHaveLength(0);
  });

  it("moves an inferred track back when the consensus disappears", () => {
    const withConsensus = copies([...base(), track({ key: "a4", artist: "A", family: "Rock" })]);
    applyArtistConsensus(withConsensus);
    let state = initialState(withConsensus);
    expect(groupOf(state, "a2")).toBe("Rock");

    // two Pop tracks of A arrive: 2 Rock x 2 Pop, no consensus anymore
    const split = copies([...withConsensus.map(({ inferredFrom, ...t }) => (inferredFrom ? { ...t, family: inferredFrom.family } : t)), ...many(2, { artist: "A", family: "Pop" })]);
    applyArtistConsensus(split);
    state = reducer(state, { type: "sync", tracks: split });
    expect(groupOf(state, "a2")).toBe(OTHER);
  });

  it("legacy saved states keep inferred tracks where they are", () => {
    const before = base();
    const tracks = copies([...before, track({ key: "a4", artist: "A", family: "Rock" })]);
    applyArtistConsensus(tracks);
    // saved before `manual`/`inferredPlaced` existed, with a2 in "Outros"
    const legacy = upgradeSaved({ groups: initialState(before).groups }, tracks);
    expect(pendingSync(legacy, tracks).map((t) => t.key)).toEqual(["a4"]);
  });
});

describe("bulk review actions", () => {
  it("moveMany marks tracks manual and 'Mover para Outros' works even after Outros was merged", () => {
    const tracks = [...many(3, { artist: "R", family: "Rock" }), ...many(3, { artist: "P", family: "Pop" })];
    let state = initialState(tracks);
    const pop = state.groups.find((g) => g.id === "Pop")!.trackKeys;

    state = reducer(state, { type: "moveMany", trackKeys: pop.slice(0, 2), toGroupId: "Rock" });
    expect(state.groups.find((g) => g.id === "Rock")!.trackKeys).toHaveLength(5);
    expect(state.manual[pop[0]] && state.manual[pop[1]]).toBe(true);

    state = reducer(state, { type: "merge", fromId: OTHER, intoId: "Pop" });
    state = reducer(state, { type: "moveMany", trackKeys: [pop[0]], toGroupId: OTHER });
    expect(groupOf(state, pop[0])).toBe(OTHER);
  });

  it("createGroup never collides with a family id", () => {
    let state = initialState(many(3, { artist: "R", family: "Rock" }));
    const keys = state.groups[0].trackKeys;
    state = reducer(state, { type: "createGroup", name: "Rock", trackKeys: [keys[0]] });
    state = reducer(state, { type: "createGroup", name: "Rock", trackKeys: [keys[1]] });
    const ids = state.groups.map((g) => g.id);
    expect(ids).toContain("Rock");
    expect(ids).toContain("custom:Rock");
    expect(ids).toContain("custom:Rock 2");
    // "Outros" stays last
    expect(ids.at(-1)).toBe(OTHER);
  });
});

describe("empty groups", () => {
  // the country lookup resolved every uncertain funk track: the group stays, with no tracks
  function resolvedFunk() {
    const funk = many(3, { artist: "MC", family: FUNK_UNCERTAIN });
    const tracks = [...many(3, { artist: "R", family: "Rock" }), ...funk];
    const before = initialState(tracks);
    // as applyCountries does: the tag family stays in baseFamily
    const resolved = tracks.map((t) => (funk.includes(t) ? { ...t, baseFamily: FUNK_UNCERTAIN, family: FUNK_BR } : t));
    const after = reducer(before, { type: "sync", tracks: resolved });
    return { before, after, tracks: resolved };
  }

  it("a fully resolved funk analysis leaves Funk (incerto) empty, never with tracks", () => {
    const { before, after } = resolvedFunk();
    expect(before.groups.find((g) => g.id === FUNK_UNCERTAIN)?.trackKeys).toHaveLength(3);
    expect(after.groups.find((g) => g.id === FUNK_UNCERTAIN)?.trackKeys ?? []).toHaveLength(0);
    expect(after.groups.find((g) => g.id === FUNK_BR)?.trackKeys).toHaveLength(3);
  });

  it("bulk checks leave empty groups alone", () => {
    const { after } = resolvedFunk();
    const all = reducer(after, { type: "setInclude", groupIds: "all", on: true });
    expect(all.groups.filter((g) => !hasTracks(g)).map((g) => g.include)).toEqual([false, false]);
    const rec = reducer(after, { type: "includeRecommended" });
    expect(rec.groups.filter((g) => !hasTracks(g)).every((g) => !g.include)).toBe(true);
  });

  it("the creation plan never has an empty group, even a checked one", () => {
    const { after, tracks } = resolvedFunk();
    const checked = { ...after, groups: after.groups.map((g) => ({ ...g, include: true })) };
    const plan = planPlaylists(checked.groups, new Map(tracks.map((t) => [t.key, t])));
    expect(plan.map((p) => p.groupId).sort()).toEqual([FUNK_BR, "Rock"].sort());
    expect(plan.every((p) => p.uris.length > 0)).toBe(true);
  });
});
