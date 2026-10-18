// WCAG AA (4.5:1) for the text/background pairs the UI uses, in both themes, read straight
// from the tokens in app/globals.css. Genre colors are checked as text on the surfaces and as
// the fill under text (spectrum labels, checked boxes), both with the browser clipping
// out-of-gamut colors and with chroma reduction. `CONTRAST_TABLE=1` prints the table.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENRE_HUES, hashHue, UNKNOWN_CHROMA } from "@/app/genre-colors";
import { OTHER } from "@/lib/genre-families";
import { contrast, hexToLinear, linearToOklch, mixOklch, oklchToLinear, over, toGamut, type Oklch, type Rgb } from "./color";

const AA = 4.5;
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const dark = block(":root");
const THEMES = { dark, light: { ...dark, ...block(':root[data-theme="light"]') } };
type Tokens = typeof dark;

const hex = (t: Tokens, name: string) => hexToLinear(t[name]);

function genreLch(t: Tokens, id: string): Oklch {
  if (id === OTHER) return [Number(t["genre-neutral-l"]), 0, 0];
  const [h, c] = GENRE_HUES[id] ?? [hashHue(id), UNKNOWN_CHROMA];
  return [Number(t["genre-l"]), c * Number(t["genre-c"]), h];
}

// a family outside the table gets a hashed hue; any of those must pass too
const GENRES = [...Object.keys(GENRE_HUES), OTHER, "Família nova", "Shoegaze BR"];

type Pair = { label: string; fg: Rgb; bg: Rgb };

function pairs(t: Tokens, gamut: "clip" | "map"): Pair[] {
  const bg = { cafe: hex(t, "cafe"), grafite: hex(t, "grafite"), "grafite-2": hex(t, "grafite-2") };
  const list: Pair[] = [];
  for (const [name, surface] of Object.entries(bg)) {
    list.push({ label: `papel on ${name}`, fg: hex(t, "papel"), bg: surface });
    list.push({ label: `areia on ${name}`, fg: hex(t, "areia"), bg: surface });
    list.push({ label: `alerta on ${name}`, fg: hex(t, "alerta"), bg: surface });
    list.push({ label: `erro on ${name}`, fg: hex(t, "erro"), bg: surface });
    list.push({ label: `ok on ${name}`, fg: hex(t, "ok"), bg: surface });
  }
  list.push({ label: "cafe on papel (filled button)", fg: hex(t, "cafe"), bg: hex(t, "papel") });
  // tinted notices: bg-alerta/10, bg-alerta/15 (quota strip), bg-erro/10
  for (const [name, surface] of Object.entries(bg)) {
    list.push({ label: `alerta on alerta/10 over ${name}`, fg: hex(t, "alerta"), bg: over(hex(t, "alerta"), 0.1, surface) });
    list.push({ label: `areia on alerta/10 over ${name}`, fg: hex(t, "areia"), bg: over(hex(t, "alerta"), 0.1, surface) });
    list.push({ label: `erro on erro/10 over ${name}`, fg: hex(t, "erro"), bg: over(hex(t, "erro"), 0.1, surface) });
  }
  list.push({ label: "alerta on alerta/15 over cafe", fg: hex(t, "alerta"), bg: over(hex(t, "alerta"), 0.15, bg.cafe) });
  list.push({ label: "areia on alerta/15 over cafe", fg: hex(t, "areia"), bg: over(hex(t, "alerta"), 0.15, bg.cafe) });

  const cafeLch = linearToOklch(bg.cafe);
  for (const id of GENRES) {
    const lch = genreLch(t, id);
    const color = gamut === "clip" ? oklchToLinear(lch) : toGamut(lch);
    for (const [name, surface] of Object.entries(bg)) list.push({ label: `${id} text on ${name}`, fg: color, bg: surface });
    list.push({ label: `cafe text on ${id} bar`, fg: bg.cafe, bg: color });
    // unchecked spectrum band: color-mix(genre 28%/45%, cafe) under papel text
    for (const p of [0.28, 0.45]) list.push({ label: `papel on ${id} dimmed ${p * 100}%`, fg: hex(t, "papel"), bg: mixOklch(lch, p, cafeLch) });
  }
  return list;
}

describe("contrast (WCAG AA)", () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const gamut of ["clip", "map"] as const) {
      it(`${theme} theme, out-of-gamut colors ${gamut === "clip" ? "clipped" : "mapped"}`, () => {
        const results = pairs(tokens, gamut).map((p) => ({ pair: p.label, ratio: Number(contrast(p.fg, p.bg).toFixed(2)) }));
        if (process.env.CONTRAST_TABLE && gamut === "clip") console.table(results);
        expect(results.filter((r) => r.ratio < AA)).toEqual([]);
      });
    }
  }

  it("the light theme really changes the tokens it needs", () => {
    for (const name of ["cafe", "grafite", "grafite-2", "fio", "papel", "areia", "alerta", "erro", "ok", "genre-l"]) {
      expect(THEMES.light[name], name).not.toBe(THEMES.dark[name]);
    }
  });
});
