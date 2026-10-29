// @vitest-environment jsdom
// The footer button follows the genre selection live (real CreatePlaylists; no Spotify calls:
// server actions are mocked and nothing here opens the confirmation).

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Preview } from "@/app/preview";
import { FUNK_BR, FUNK_UNCERTAIN } from "@/lib/genre-families";
import { genreName } from "@/lib/i18n";
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
    // "Outros" has no tracks: hidden and not counted
    expect(screen.getByText(/3 de 3 marcados/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Marcar só Jazz" }));
    await settle();
    expect(footer().textContent).toBe("Criar 1 playlist · 4 faixas");

    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await settle();
    expect(screen.getByRole("button", { name: "Nenhum gênero marcado" })).toBeTruthy();
  });
});

describe("empty groups", () => {
  const props = {
    duplicates: 0,
    consensus: { inferred: 0, fromOther: 0, noLongerLow: 0 },
    storageKey: "empty",
    onSpotifyChanged: () => {},
    reorderToken: 0,
  };
  const cards = () => screen.queryAllByRole("textbox", { name: "Nome da playlist" }).map((i) => (i as HTMLInputElement).value);

  it("a fully resolved funk analysis shows no Funk (incerto) card and doesn't count it", async () => {
    const user = userEvent.setup();
    const funk = many(3, { artist: "MC", family: FUNK_UNCERTAIN });
    const before = [...tracks, ...funk];
    const { rerender } = render(<Preview tracks={before} {...props} />);
    await settle();
    expect(cards()).toContain(genreName("pt-BR", FUNK_UNCERTAIN));

    // the country lookup finished: every funk artist is Brazilian
    rerender(
      <Preview tracks={before.map((t) => (funk.includes(t) ? { ...t, baseFamily: FUNK_UNCERTAIN, family: FUNK_BR } : t))} {...props} />,
    );
    await settle();
    expect(cards()).not.toContain(genreName("pt-BR", FUNK_UNCERTAIN));
    expect(cards()).toContain(FUNK_BR);

    await user.click(screen.getByRole("button", { name: "Marcar todos" }));
    await settle();
    expect(screen.getByText(/4 de 4 marcados/)).toBeTruthy();
    expect(footer().textContent).toBe("Criar 4 playlists · 18 faixas");
  });

  it("a group emptied by moving its tracks disappears and leaves the footer", async () => {
    const user = userEvent.setup();
    render(<Preview tracks={tracks} {...props} />);
    await settle();
    expect(footer().textContent).toBe("Criar 3 playlists · 15 faixas");

    await user.click(screen.getByRole("button", { name: "Expandir todos" }));
    await settle();
    const jazz = screen.getByDisplayValue("Jazz").closest("details") as HTMLElement;
    await user.click(within(jazz).getByRole("checkbox", { name: /^Selecionar todas as filtradas/ }));
    await user.click(within(jazz).getByRole("button", { name: "Mover para Outros" }));
    await settle();

    expect(cards()).not.toContain("Jazz");
    // "Outros" got the tracks: shown now, unchecked
    expect(cards()).toContain("Outros");
    expect(screen.getByText(/2 de 3 marcados/)).toBeTruthy();
    expect(footer().textContent).toBe("Criar 2 playlists · 11 faixas");
  });
});
