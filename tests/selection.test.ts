import { describe, expect, it } from "vitest";
import {
  dragSelection,
  filterItems,
  invert,
  rangeIds,
  setMany,
  toggleOne,
  type AnalysisInfo,
  type PickerItem,
} from "@/lib/selection";

const ids = ["a", "b", "c", "d", "e", "f"];
const set = (...xs: string[]) => new Set(xs);
const sorted = (s: Set<string>) => [...s].sort();

describe("rangeIds (Shift+click / Shift+Space)", () => {
  it("covers anchor to target inclusive, in either direction", () => {
    expect(rangeIds(ids, "b", "e")).toEqual(["b", "c", "d", "e"]);
    expect(rangeIds(ids, "e", "b")).toEqual(["b", "c", "d", "e"]);
  });

  it("respects the active filter: only visible ids are in the range", () => {
    const visible = ["a", "c", "e"];
    expect(rangeIds(visible, "a", "e")).toEqual(["a", "c", "e"]);
  });

  it("without a visible anchor the range is just the target", () => {
    expect(rangeIds(ids, null, "c")).toEqual(["c"]);
    expect(rangeIds(["c", "d"], "a", "c")).toEqual(["c"]);
    expect(rangeIds(ids, "a", "zz")).toEqual([]);
  });
});

describe("drag to select", () => {
  it("applies the pressed row's new state to every row dragged over", () => {
    const original = set("c");
    // pressing "a" (unchecked) checks it; dragging to "d" checks a..d
    expect(sorted(dragSelection(original, ids, 0, 3, true))).toEqual(["a", "b", "c", "d"]);
  });

  it("unchecking drags uncheck, and rows left behind go back to their state", () => {
    const original = set("a", "b", "c", "d");
    expect(sorted(dragSelection(original, ids, 1, 3, false))).toEqual(["a"]);
    // dragging back up to "c": "d" is restored
    expect(sorted(dragSelection(original, ids, 1, 2, false))).toEqual(["a", "d"]);
  });

  it("works upward and clamps to the list", () => {
    expect(sorted(dragSelection(set(), ids, 4, -5, true))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("never mutates the original selection", () => {
    const original = set("a");
    dragSelection(original, ids, 0, 5, false);
    expect(sorted(original)).toEqual(["a"]);
  });
});

describe("bulk actions", () => {
  it("invert flips only the given ids", () => {
    expect(sorted(invert(set("a", "b", "z"), ["a", "c"]))).toEqual(["b", "c", "z"]);
  });

  it("setMany and toggleOne", () => {
    expect(sorted(setMany(set("a"), ["b", "c"], true))).toEqual(["a", "b", "c"]);
    expect(sorted(setMany(set("a", "b"), ["a"], false))).toEqual(["b"]);
    expect(sorted(toggleOne(set("a"), "a"))).toEqual([]);
    expect(sorted(toggleOne(set(), "a"))).toEqual(["a"]);
  });
});

describe("filterItems", () => {
  const items: PickerItem[] = [
    { id: "liked", name: "Músicas curtidas", snapshotId: "10|x" },
    { id: "p1", name: "Rock Nacional", snapshotId: "s1" },
    { id: "p2", name: "Funk 2024", snapshotId: "s2-new" },
    { id: "p3", name: "Jazz", snapshotId: "s3" },
  ];
  const info = new Map<string, AnalysisInfo>([
    ["p1", { status: "concluída", snapshotId: "s1" }],
    ["p2", { status: "concluída", snapshotId: "s2-old" }],
    ["p3", { status: "erro", snapshotId: "s3" }],
  ]);
  const names = (xs: PickerItem[]) => xs.map((x) => x.id);

  it("search by name, ignoring case and accents", () => {
    expect(names(filterItems(items, "MUSICAS", "all", info))).toEqual(["liked"]);
    expect(names(filterItems(items, "rock", "all", info))).toEqual(["p1"]);
  });

  it("quick filters: not analyzed, with error, changed since the analysis", () => {
    expect(names(filterItems(items, "", "unanalyzed", info))).toEqual(["liked", "p3"]);
    expect(names(filterItems(items, "", "error", info))).toEqual(["p3"]);
    expect(names(filterItems(items, "", "changed", info))).toEqual(["p2"]);
  });

  it("search and quick filter combine", () => {
    expect(names(filterItems(items, "jazz", "unanalyzed", info))).toEqual(["p3"]);
    expect(names(filterItems(items, "rock", "error", info))).toEqual([]);
  });
});
