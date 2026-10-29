// @vitest-environment jsdom
// "Ordenar por" in the preview: the segmented control reorders the cards and remembers the choice.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Preview } from "@/app/preview";
import { many } from "./helpers";

vi.mock("@/app/create-playlists", () => ({ CreatePlaylists: () => null }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const tracks = [
  ...many(3, { artist: "R", family: "Rock" }),
  ...many(5, { artist: "P", family: "Pop" }),
  ...many(4, { artist: "J", family: "Jazz" }),
];

const cardNames = () =>
  screen.getAllByRole("textbox", { name: "Nome da playlist" }).map((i) => (i as HTMLInputElement).value);

describe("preview sort", () => {
  it("sorts by size, then by name after picking Nome, and saves the choice", async () => {
    const user = userEvent.setup();
    render(
      <Preview
        tracks={tracks}
        duplicates={0}
        consensus={{ inferred: 0, fromOther: 0, noLongerLow: 0 }}
        storageKey="sort-test"
        onSpotifyChanged={() => {}}
        reorderToken={0}
      />,
    );
    expect(cardNames()).toEqual(["Pop", "Jazz", "Rock"]);

    const group = screen.getByRole("radiogroup", { name: "Ordenar por" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Tamanho", "Nome", "A revisar"]);
    await user.click(within(group).getByRole("radio", { name: "Nome" }));

    expect(cardNames()).toEqual(["Jazz", "Pop", "Rock"]);
    expect(localStorage.getItem("preview-sort")).toBe("name");
  });
});
