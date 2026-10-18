// @vitest-environment jsdom
// The footer button follows the genre selection live (real CreatePlaylists; no Spotify calls:
// server actions are mocked and nothing here opens the confirmation).

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Preview } from "@/app/preview";
import { many } from "./helpers";

vi.mock("@/app/actions", () => ({}));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const tracks = [
  ...many(6, { artist: "R", family: "Rock" }),
  ...many(5, { artist: "P", family: "Pop" }),
  ...many(4, { artist: "J", family: "Jazz" }),
];

const footer = () => screen.getByRole("button", { name: /^Criar \d+ playlists? · / });
// the footer reads the deferred groups: let React flush them
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("footer", () => {
  it("shows checked genres and their tracks, and follows every change", async () => {
    const user = userEvent.setup();
    render(
      <Preview
        tracks={tracks}
        duplicates={0}
        consensus={{ inferred: 0, fromOther: 0, noLongerLow: 0 }}
        storageKey="footer"
        onSpotifyChanged={() => {}}
        reorderToken={0}
      />,
    );
    await settle();
    expect(footer().textContent).toBe("Criar 3 playlists · 15 faixas");
    expect(screen.getByText(/3 de 4 marcados/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Marcar só Jazz" }));
    await settle();
    expect(footer().textContent).toBe("Criar 1 playlist · 4 faixas");

    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await settle();
    expect(screen.getByRole("button", { name: "Nenhum gênero marcado" })).toBeTruthy();
  });
});
