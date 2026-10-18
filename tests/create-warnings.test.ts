import { describe, expect, it } from "vitest";
import type { ClassifiedTrack } from "@/lib/classify";
import { createWarnings } from "@/lib/create-warnings";
import { FUNK_UNCERTAIN, OTHER } from "@/lib/genre-families";
import type { Group } from "@/lib/preview-state";
import { track } from "./helpers";

const group = (id: string, ts: ClassifiedTrack[], include = true): Group => ({ id, name: id, include, trackKeys: ts.map((t) => t.key) });

describe("createWarnings", () => {
  const rockLow = [...Array.from({ length: 6 }, () => track({ artist: "R", family: "Rock" })), ...Array.from({ length: 4 }, () => track({ artist: "R", family: "Rock", lowConfidence: "x" }))];
  const popLow = [...Array.from({ length: 7 }, () => track({ artist: "P", family: "Pop" })), ...Array.from({ length: 3 }, () => track({ artist: "P", family: "Pop", lowConfidence: "x" }))];
  const other = [track({ artist: "X" })];
  const uncertain = [track({ artist: "M", family: FUNK_UNCERTAIN })];
  const all = new Map([...rockLow, ...popLow, ...other, ...uncertain].map((t) => [t.key, t]));

  it("warns about checked genres with more than 30% low confidence (30% exactly doesn't)", () => {
    const w = createWarnings([group("Rock", rockLow), group("Pop", popLow)], all);
    expect(w.lowConfidence).toEqual([{ groupId: "Rock", name: "Rock", share: 0.4 }]);
  });

  it("ignores unchecked genres", () => {
    expect(createWarnings([group("Rock", rockLow, false)], all).lowConfidence).toEqual([]);
  });

  it("asks for extra confirmation when Outros or Funk (incerto) are checked", () => {
    const w = createWarnings([group(OTHER, other), group(FUNK_UNCERTAIN, uncertain), group("Pop", popLow)], all);
    expect(w.uncertain.map((u) => u.groupId)).toEqual([OTHER, FUNK_UNCERTAIN]);
    expect(createWarnings([group(OTHER, other, false), group("Pop", popLow)], all).uncertain).toEqual([]);
  });

  it("empty groups don't warn", () => {
    expect(createWarnings([group(OTHER, [])], all)).toEqual({ lowConfidence: [], uncertain: [] });
  });
});
