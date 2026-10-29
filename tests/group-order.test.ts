import { describe, expect, it } from "vitest";
import { FUNK_UNCERTAIN, OTHER } from "@/lib/genre-families";
import { orderGroups, sortGroupIds } from "@/lib/group-order";
import { initialState, reducer, type Group } from "@/lib/preview-state";
import { track } from "./helpers";

const g = (id: string, size: number, name = id): Group => ({
  id,
  name,
  include: false,
  trackKeys: Array.from({ length: size }, (_, i) => `${id}-${i}`),
});

const groups = [g(OTHER, 500), g("Rock", 40), g(FUNK_UNCERTAIN, 300), g("Pop", 120), g("Jazz", 40, "jazz")];

describe("sortGroupIds", () => {
  it("size: largest first, Funk (incerto) and Outros last whatever their size", () => {
    // Rock and Jazz tie on size: name decides
    expect(sortGroupIds(groups, "size", () => 0)).toEqual(["Pop", "Jazz", "Rock", FUNK_UNCERTAIN, OTHER]);
  });

  it("name: alphabetical, case-insensitive, still with the uncertain ones last", () => {
    expect(sortGroupIds(groups, "name", () => 0)).toEqual(["Jazz", "Pop", "Rock", FUNK_UNCERTAIN, OTHER]);
  });

  it("review: most low-confidence tracks first", () => {
    const low: Record<string, number> = { Rock: 30, Pop: 2, Jazz: 10 };
    expect(sortGroupIds(groups, "review", (x) => low[x.id] ?? 0)).toEqual(["Rock", "Jazz", "Pop", FUNK_UNCERTAIN, OTHER]);
  });
});

describe("orderGroups: stable while editing", () => {
  it("keeps the saved order when tracks move between groups", () => {
    const order = sortGroupIds(groups, "size", () => 0);
    // Rock grows past Pop after an edit: the cards don't move until the next sort
    const edited = groups.map((x) => (x.id === "Rock" ? g("Rock", 999) : x));
    expect(orderGroups(edited, order).map((x) => x.id)).toEqual(order);
  });

  it("a group created after the sort goes before Funk (incerto) and Outros", () => {
    const order = sortGroupIds(groups, "size", () => 0);
    const withNew = [...groups, g("custom:Minhas", 3, "Minhas")];
    expect(orderGroups(withNew, order).map((x) => x.id)).toEqual(["Pop", "Jazz", "Rock", "custom:Minhas", FUNK_UNCERTAIN, OTHER]);
  });

  it("merged-away groups disappear from the order", () => {
    const order = sortGroupIds(groups, "size", () => 0);
    expect(orderGroups(groups.filter((x) => x.id !== "Pop"), order).map((x) => x.id)).toEqual(["Jazz", "Rock", FUNK_UNCERTAIN, OTHER]);
  });
});

describe("initial selection", () => {
  it("Outros and Funk (incerto) start unchecked, even when they're the largest", () => {
    const tracks = [
      ...Array.from({ length: 10 }, () => track({ artist: "MC", family: FUNK_UNCERTAIN })),
      ...Array.from({ length: 3 }, () => track({ artist: "R", family: "Rock" })),
      ...Array.from({ length: 20 }, () => track({ artist: "X" })),
    ];
    const state = initialState(tracks);
    const include = Object.fromEntries(state.groups.map((x) => [x.id, x.include]));
    expect(include).toEqual({ [FUNK_UNCERTAIN]: false, Rock: true, [OTHER]: false });
    // and checking one stays tied to its id after a re-sort
    const toggled = reducer(state, { type: "toggleInclude", groupId: OTHER });
    expect(orderGroups(toggled.groups, ["Rock", FUNK_UNCERTAIN, OTHER]).find((x) => x.id === OTHER)!.include).toBe(true);
  });
});
