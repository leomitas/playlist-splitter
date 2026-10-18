// @vitest-environment jsdom
// Genre list interactions with real keyboard/pointer sequences (user-event): spectrum bands.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FUNK_UNCERTAIN } from "@/lib/genre-families";
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
