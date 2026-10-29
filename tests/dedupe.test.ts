import { describe, expect, it } from "vitest";
import { dedupe, titleKey } from "@/lib/dedupe";

type T = { key: string; name: string; artist: string };
const t = (key: string, name: string, artist: string): T => ({ key, name, artist });
const run = (tracks: T[]) => dedupe(tracks, (x) => x.artist).map((x) => x.key);

describe("dedupe by artist + title", () => {
  it("drops the same title by the same artist under another Spotify id", () => {
    expect(run([t("a", "A Dança - Ao Vivo", "Grupo X"), t("b", "A Dança - Ao Vivo", "Grupo X")])).toEqual(["a"]);
    expect(run([t("p1", "Purple Rain", "Prince"), t("p2", "Purple Rain", "Prince")])).toEqual(["p1"]);
  });

  it("ignores case, accents, spacing and punctuation", () => {
    expect(run([t("a", "A Dança - Ao Vivo", "Grupo X"), t("b", "a danca  (ao vivo)", "GRUPO X")])).toEqual(["a"]);
  });

  it("keeps versions with a different title", () => {
    expect(
      run([
        t("1", "Purple Rain", "Prince"),
        t("2", "Purple Rain - Slowed", "Prince"),
        t("3", "Purple Rain (Remix)", "Prince"),
        t("4", "A Dança", "Grupo X"),
        t("5", "A Dança - Ao Vivo", "Grupo X"),
      ]),
    ).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("same title by another artist is another song", () => {
    expect(run([t("a", "Hallelujah", "Leonard Cohen"), t("b", "Hallelujah", "Jeff Buckley")])).toEqual(["a", "b"]);
  });

  it("still drops repeated Spotify ids, and never collapses tracks with an empty artist or title", () => {
    expect(run([t("a", "X", "Y"), t("a", "X", "Y")])).toEqual(["a"]);
    expect(run([t("u1", "", ""), t("u2", "", ""), t("u3", "Song", "")])).toEqual(["u1", "u2", "u3"]);
    expect(titleKey("", "Artist")).toBeNull();
  });

  it("checks against tracks already analyzed", () => {
    const seen = { keys: new Set(["old"]), titles: new Set([titleKey("Purple Rain", "Prince")!]) };
    expect(dedupe([t("new", "Purple Rain", "Prince"), t("n2", "Kiss", "Prince")], (x) => x.artist, seen).map((x) => x.key)).toEqual(["n2"]);
  });
});
