// @vitest-environment jsdom
// Genre list interactions with real keyboard/pointer sequences (user-event): spectrum bands.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FUNK_UNCERTAIN, OTHER } from "@/lib/genre-families";
import { Preview } from "@/app/preview";
import { many } from "./helpers";

// the footer talks to Spotify; it isn't under test here
vi.mock("@/app/create-playlists", () => ({ CreatePlaylists: () => null }));

// jsdom has no layout: the element "under the pointer" is the last one the pointer entered
let underPointer: Element | null = null;
beforeEach(() => {
  localStorage.clear();
  underPointer = null;
  document.elementFromPoint = () => underPointer;
  document.addEventListener("pointerover", (e) => (underPointer = e.target as Element), true);
});
afterEach(cleanup);

const tracks = [
  ...many(6, { artist: "R", family: "Rock" }),
  ...many(5, { artist: "P", family: "Pop" }),
  ...many(4, { artist: "J", family: "Jazz" }),
  ...many(3, { artist: "F", family: "Folk" }),
  ...many(3, { artist: "M", family: FUNK_UNCERTAIN }),
];

function renderPreview() {
  render(
    <Preview
      tracks={tracks}
      duplicates={0}
      consensus={{ inferred: 0, fromOther: 0, noLongerLow: 0 }}
      storageKey="test"
      onSpotifyChanged={() => {}}
      reorderToken={0}
    />,
  );
  const spectrum = screen.getByRole("group", { name: /Espectro de gêneros/ });
  const band = (name: string) => within(spectrum).getByRole("button", { name: new RegExp(`^${name}:`) });
  return { band };
}

const pressed = (el: Element) => el.getAttribute("aria-pressed");
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

describe("spectrum bands", () => {
  it("are toggle buttons with aria-pressed; click, Enter and Space toggle", async () => {
    const user = userEvent.setup();
    const { band } = renderPreview();
    expect(pressed(band("Rock"))).toBe("true");
    expect(pressed(band(FUNK_UNCERTAIN.replace(/[()]/g, "\\$&")))).toBe("false");

    await user.click(band("Rock"));
    expect(pressed(band("Rock"))).toBe("false");

    band("Rock").focus();
    await user.keyboard("{Enter}");
    expect(pressed(band("Rock"))).toBe("true");
    await user.keyboard(" ");
    expect(pressed(band("Rock"))).toBe("false");
  });

  it("data-state follows the checked groups (Clear, Check all, Only this)", async () => {
    const user = userEvent.setup();
    const { band } = renderPreview();
    const states = () => ["Rock", "Pop", "Jazz", "Folk"].map((name) => band(name).getAttribute("data-state"));
    expect(states()).toEqual(["included", "included", "included", "included"]);

    await user.click(screen.getByRole("button", { name: "Limpar" }));
    expect(states()).toEqual(["excluded", "excluded", "excluded", "excluded"]);

    await user.click(screen.getByRole("button", { name: "Marcar todos" }));
    expect(states()).toEqual(["included", "included", "included", "included"]);

    await user.click(screen.getByRole("button", { name: "Marcar só Jazz" }));
    expect(states()).toEqual(["excluded", "excluded", "included", "excluded"]);
  });

  it("Shift+click selects the range from the last band clicked", async () => {
    const user = userEvent.setup();
    const { band } = renderPreview();
    // anchor: Rock (unchecks it); then Shift+click Folk unchecks Rock..Folk in display order
    await user.click(band("Rock"));
    await user.keyboard("{Shift>}");
    await user.click(band("Folk"));
    await user.keyboard("{/Shift}");
    for (const name of ["Rock", "Pop", "Jazz", "Folk"]) expect(pressed(band(name))).toBe("false");
  });

  it("dragging over bands gives them the state the first band took", async () => {
    const user = userEvent.setup();
    const { band } = renderPreview();
    // Pop starts checked: pressing it unchecks, dragging to Folk unchecks Pop, Jazz, Folk
    await user.pointer([{ keys: "[MouseLeft>]", target: band("Pop") }, { target: band("Jazz") }, { target: band("Folk") }]);
    await frame();
    await frame();
    await user.pointer({ keys: "[/MouseLeft]", target: band("Folk") });
    for (const name of ["Pop", "Jazz", "Folk"]) expect(pressed(band(name))).toBe("false");
    expect(pressed(band("Rock"))).toBe("true");
  });

  it("Esc during a drag restores the bands", async () => {
    const user = userEvent.setup();
    const { band } = renderPreview();
    await user.pointer([{ keys: "[MouseLeft>]", target: band("Pop") }, { target: band("Folk") }]);
    await frame();
    await frame();
    expect(pressed(band("Jazz"))).toBe("false");
    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[/MouseLeft]", target: band("Folk") });
    for (const name of ["Pop", "Jazz", "Folk"]) expect(pressed(band(name))).toBe("true");
  });
});

describe("genre cards: checkboxes", () => {
  // the mouse acts on the checkbox's wrapper (the checkbox itself ignores pointer events)
  const box = (name: string) => screen.getByRole("checkbox", { name: `Criar playlist de ${name}` });
  const hit = (name: string) => box(name).parentElement!;
  const isChecked = (name: string) => (box(name) as HTMLInputElement).checked;
  const cardOrder = () =>
    screen.getAllByRole("checkbox", { name: /^Criar playlist de / }).map((c) => c.getAttribute("aria-label")!.slice(18));

  it("recommended genres start checked; Funk (incerto) doesn't", () => {
    renderPreview();
    // "Outros" always exists (empty here) so tracks can be moved to it
    expect(cardOrder()).toEqual(["Rock", "Pop", "Jazz", "Folk", FUNK_UNCERTAIN, OTHER]);
    expect(["Rock", "Pop", "Jazz", "Folk"].every(isChecked)).toBe(true);
    expect(isChecked(FUNK_UNCERTAIN)).toBe(false);
    expect(isChecked(OTHER)).toBe(false);
  });

  it("Shift+click checks/unchecks the range in the order shown", async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.click(hit("Rock")); // anchor, unchecks Rock
    await user.keyboard("{Shift>}");
    await user.click(hit("Jazz"));
    await user.keyboard("{/Shift}");
    expect(["Rock", "Pop", "Jazz"].map(isChecked)).toEqual([false, false, false]);
    expect(isChecked("Folk")).toBe(true);
  });

  it("Shift+click respects the genre search (hidden cards are skipped)", async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await user.type(screen.getByRole("searchbox", { name: "Buscar gênero pelo nome" }), "o");
    // "o" matches Rock, Pop, Folk, Funk (incerto) and Outros; Jazz is hidden
    expect(cardOrder()).toEqual(["Rock", "Pop", "Folk", FUNK_UNCERTAIN, OTHER]);
    await user.click(hit("Rock"));
    await user.keyboard("{Shift>}");
    await user.click(hit("Folk"));
    await user.keyboard("{/Shift}");
    await user.clear(screen.getByRole("searchbox", { name: "Buscar gênero pelo nome" }));
    expect(["Rock", "Pop", "Jazz", "Folk"].map(isChecked)).toEqual([true, true, false, true]);
  });

  it("Space toggles and Shift+Space selects a range from the keyboard", async () => {
    const user = userEvent.setup();
    renderPreview();
    box("Pop").focus();
    await user.keyboard(" ");
    expect(isChecked("Pop")).toBe(false);
    box("Folk").focus();
    await user.keyboard("{Shift>} {/Shift}");
    expect(["Pop", "Jazz", "Folk"].map(isChecked)).toEqual([false, false, false]);
    expect(isChecked("Rock")).toBe(true);
    expect(document.activeElement).toBe(box("Folk"));
  });

  it("dragging over checkboxes applies the first one's new state; Esc restores", async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.pointer([{ keys: "[MouseLeft>]", target: hit("Pop") }, { target: hit("Jazz") }, { target: hit("Folk") }]);
    await frame();
    await frame();
    await user.pointer({ keys: "[/MouseLeft]", target: hit("Folk") });
    expect(["Rock", "Pop", "Jazz", "Folk"].map(isChecked)).toEqual([true, false, false, false]);

    await user.pointer([{ keys: "[MouseLeft>]", target: hit("Rock") }, { target: hit("Jazz") }]);
    await frame();
    await frame();
    expect(isChecked("Pop")).toBe(false);
    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[/MouseLeft]", target: hit("Jazz") });
    expect(["Rock", "Pop", "Jazz", "Folk"].map(isChecked)).toEqual([true, false, false, false]);
  });

  it("touch doesn't start a drag (the page keeps scrolling); a tap toggles once", async () => {
    const user = userEvent.setup();
    renderPreview();
    // finger down on Pop, sliding over Jazz: no drag selection
    await user.pointer([{ keys: "[TouchA>]", target: hit("Pop") }, { pointerName: "TouchA", target: hit("Jazz") }]);
    await frame();
    await frame();
    expect(["Pop", "Jazz"].map(isChecked)).toEqual([true, true]);
    await user.pointer({ keys: "[/TouchA]", target: hit("Jazz") });
    // (the simulator fires a click where the finger lifts; a real scrolling touch doesn't)
    expect(isChecked("Pop")).toBe(true);

    await user.pointer({ keys: "[TouchA]", target: hit("Folk") });
    expect(isChecked("Folk")).toBe(false);
  });

  it("Só este checks one genre, and Desfazer brings the previous selection back", async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.click(screen.getByRole("button", { name: "Marcar só Jazz" }));
    expect(["Rock", "Pop", "Jazz", "Folk"].map(isChecked)).toEqual([false, false, true, false]);
    await user.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(["Rock", "Pop", "Jazz", "Folk"].map(isChecked)).toEqual([true, true, true, true]);
  });
});
