import { describe, expect, it } from "vitest";
import { FUNK_UNCERTAIN, OTHER } from "@/lib/genre-families";
import { initialState, reducer, upgradeSaved, type PreviewState } from "@/lib/preview-state";
import { many } from "./helpers";

// Rock 6, Pop 4, Jazz 3, Funk (incerto) 5, Outros 2
function library() {
  return [
    ...many(6, { artist: "R", family: "Rock" }),
    ...many(4, { artist: "P", family: "Pop" }),
    ...many(3, { artist: "J", family: "Jazz" }),
    ...many(5, { artist: "M", family: FUNK_UNCERTAIN }),
    ...many(2, { artist: "X" }),
  ];
}
const checked = (s: PreviewState) => s.groups.filter((g) => g.include).map((g) => g.id).sort();

describe("default after a new analysis", () => {
  it("checks the recommended groups: every genre except Outros and Funk (incerto)", () => {
    expect(checked(initialState(library()))).toEqual(["Jazz", "Pop", "Rock"]);
  });

  it("a genre arriving later starts checked, unless the user already chose by hand", () => {
    const later = many(3, { artist: "F", family: "Folk" });
    const fresh = reducer(initialState(library()), { type: "sync", tracks: [...library(), ...later] });
    expect(fresh.groups.find((g) => g.id === "Folk")!.include).toBe(true);

    let edited = reducer(initialState(library()), { type: "toggleInclude", groupId: "Pop" });
    edited = reducer(edited, { type: "sync", tracks: [...library(), ...many(3, { artist: "F2", family: "Folk" })] });
    expect(edited.groups.find((g) => g.id === "Folk")!.include).toBe(false);
  });

  it("saved states keep the user's choices (count as edited)", () => {
    const saved = upgradeSaved({ groups: initialState(library()).groups.map((g) => ({ ...g, include: g.id === "Jazz" })) }, library());
    expect(checked(saved)).toEqual(["Jazz"]);
    expect(saved.includeEdited).toBe(true);
  });
});

describe("bulk checkbox actions", () => {
  const base = () => initialState(library());

  it("Marcar todos / Limpar", () => {
    expect(checked(reducer(base(), { type: "setInclude", groupIds: "all", on: true }))).toEqual(
      ["Jazz", OTHER, "Pop", "Rock", FUNK_UNCERTAIN].sort(),
    );
    expect(checked(reducer(base(), { type: "setInclude", groupIds: "all", on: false }))).toEqual([]);
  });

  it("Inverter acts on the given (visible) groups only", () => {
    const s = reducer(base(), { type: "invertInclude", groupIds: ["Rock", OTHER] });
    expect(checked(s)).toEqual(["Jazz", OTHER, "Pop"].sort());
  });

  it("Marcar recomendados", () => {
    const cleared = reducer(base(), { type: "setInclude", groupIds: "all", on: true });
    expect(checked(reducer(cleared, { type: "includeRecommended" }))).toEqual(["Jazz", "Pop", "Rock"]);
  });

  it("Só este checks one and unchecks the rest; restoreInclude undoes it", () => {
    const before = base();
    const only = reducer(before, { type: "onlyThis", groupId: "Jazz" });
    expect(checked(only)).toEqual(["Jazz"]);
    const snapshot = Object.fromEntries(before.groups.map((g) => [g.id, g.include]));
    expect(checked(reducer(only, { type: "restoreInclude", include: snapshot }))).toEqual(checked(before));
  });

  it("setInclude on a range of ids (Shift and drag use it)", () => {
    expect(checked(reducer(base(), { type: "setInclude", groupIds: ["Pop", "Jazz"], on: false }))).toEqual(["Rock"]);
  });

  it("untouched groups keep their identity, so memoized cards don't re-render", () => {
    const before = base();
    const after = reducer(before, { type: "toggleInclude", groupId: "Pop" });
    expect(after.groups.find((g) => g.id === "Rock")).toBe(before.groups.find((g) => g.id === "Rock"));
  });

  it("Desfazer edições (reset to a fresh state) brings the recommended default back", () => {
    const edited = reducer(base(), { type: "setInclude", groupIds: "all", on: false });
    expect(checked(reducer(edited, { type: "reset", state: initialState(library()) }))).toEqual(["Jazz", "Pop", "Rock"]);
  });
});
