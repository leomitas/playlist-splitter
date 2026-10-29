import { describe, expect, it } from "vitest";
import { findTarget, findTargets, planSummary, summaryKind, targetNames } from "@/lib/existing-playlists";
import { DESCRIPTION } from "@/lib/playlist-plan";

const ME = "me";

const playlist = (id: string, name: string, over: { owner?: string; description?: string | null } = {}) => ({
  id,
  name,
  owner: { id: over.owner ?? ME },
  description: over.description === undefined ? DESCRIPTION : over.description,
});

const rock = { id: "Rock", name: "Rock" };
const other = { id: "Outros", name: "Outros" };

describe("targetNames", () => {
  it("lists the default name in every language for an unedited group", () => {
    expect(targetNames(other)).toEqual(["Outros (Playlist Splitter)", "Other (Playlist Splitter)"]);
    // same name in both languages: listed once
    expect(targetNames(rock)).toEqual(["Rock (Playlist Splitter)"]);
  });

  it("uses only the name the user typed", () => {
    expect(targetNames({ id: "Rock", name: "  Meu rock " })).toEqual(["Meu rock"]);
  });
});

describe("findTarget", () => {
  it("prefers the saved id, even after the playlist was renamed", () => {
    const renamed = playlist("p1", "Rock da estrada");
    const sameName = playlist("p2", "Rock (Playlist Splitter)");
    const t = findTarget(rock, [sameName, renamed], ME, { Rock: "p1" });
    expect(t).toEqual({ playlist: renamed, matches: 1 });
  });

  it("accepts a saved playlist whose description the user edited", () => {
    const p = playlist("p1", "Rock", { description: "minha" });
    expect(findTarget(rock, [p], ME, { Rock: "p1" })?.playlist).toBe(p);
  });

  it("falls back to the name when the saved playlist is gone", () => {
    const p = playlist("p2", "Rock (Playlist Splitter)");
    expect(findTarget(rock, [p], ME, { Rock: "deleted" })?.playlist).toBe(p);
  });

  it("finds the default name in Portuguese and in English", () => {
    const pt = playlist("pt", "Outros (Playlist Splitter)");
    const en = playlist("en", "other (playlist splitter)");
    expect(findTarget(other, [pt], ME, {})?.playlist).toBe(pt);
    expect(findTarget(other, [en], ME, {})?.playlist).toBe(en);
    expect(findTarget(other, [pt, en], ME, {})?.matches).toBe(2);
  });

  it("ignores playlists of another account, by id and by name", () => {
    const theirs = playlist("p1", "Rock (Playlist Splitter)", { owner: "someone" });
    expect(findTarget(rock, [theirs], ME, { Rock: "p1" })).toBeNull();
  });

  it("ignores same-name playlists the app didn't create", () => {
    expect(findTarget(rock, [playlist("p1", "Rock (Playlist Splitter)", { description: "" })], ME, {})).toBeNull();
  });

  it("returns null per group when nothing matches", () => {
    const p = playlist("p1", "Rock (Playlist Splitter)");
    expect(findTargets([rock, other], [p], ME, {})).toEqual({ Rock: { playlist: p, matches: 1 }, Outros: null });
  });
});

describe("planSummary", () => {
  const planned = [
    { groupId: "Rock", uris: ["a", "b"] },
    { groupId: "Pop", uris: ["c"] },
    { groupId: "Jazz", uris: [] },
  ];

  it("splits update and create and counts tracks; empty playlists don't count", () => {
    const s = planSummary(planned, (id) => id === "Rock");
    expect(s).toEqual({ update: 1, create: 1, tracks: 3 });
    expect(summaryKind(s)).toBe("mixed");
  });

  it("is update-only when every playlist exists, create-only when none does", () => {
    expect(summaryKind(planSummary(planned, () => true))).toBe("update");
    expect(summaryKind(planSummary(planned, () => false))).toBe("create");
  });
});
