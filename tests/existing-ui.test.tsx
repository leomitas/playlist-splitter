// @vitest-environment jsdom
// Genres that already have a playlist: badges, "Marcar existentes/novos", the footer and the
// confirmation. No Spotify calls: server actions and the browser loaders are mocked, and the
// confirmation is only opened, never confirmed.

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Preview } from "@/app/preview";
import { DESCRIPTION } from "@/lib/playlist-plan";
import type { Playlist } from "@/lib/spotify";
import { many } from "./helpers";

const saved = vi.hoisted(() => ({ targets: {} as Record<string, string> }));
const listed = vi.hoisted(() => ({ playlists: [] as Playlist[] }));

vi.mock("@/app/actions", () => ({}));
vi.mock("@/app/genre-targets", () => ({
  loadGenreTargets: async () => saved.targets,
  rememberGenreTarget: async () => {},
}));
// the confirmation's lookup reads the same session list; no listing, no track reads
vi.mock("@/app/spotify-data", () => ({
  loadMe: async () => ({ ok: true, data: { id: ME, display_name: "Me" } }),
  loadPlaylists: async () => ({ ok: true, data: listed.playlists }),
  loadCreatedUris: async () => ({ ok: true, data: [] }),
  rememberCreated: async () => {},
}));

const ME = "me";
const playlist = (id: string, name: string, owner = ME): Playlist => ({
  id,
  name,
  images: null,
  owner: { id: owner, display_name: null },
  collaborative: false,
  description: DESCRIPTION,
  snapshot_id: "s",
  items: { total: 0 },
});

const tracks = [
  ...many(6, { artist: "R", family: "Rock" }),
  ...many(5, { artist: "P", family: "Pop" }),
  ...many(4, { artist: "J", family: "Jazz" }),
];

// the footer reads the deferred groups: let React flush them (and the saved-map read)
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const footer = () => screen.getByRole("button", { name: /^(Criar|Atualizar) / });
const cardOf = (name: string) => screen.getByDisplayValue(name).closest("details") as HTMLElement;

function renderPreview(playlists: Playlist[]) {
  listed.playlists = playlists;
  return render(
    <Preview
      tracks={tracks}
      duplicates={0}
      consensus={{ inferred: 0, fromOther: 0, noLongerLow: 0 }}
      storageKey="existing"
      onSpotifyChanged={() => {}}
      reorderToken={0}
      account={{ myId: ME, playlists }}
    />,
  );
}

beforeAll(() => {
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
beforeEach(() => {
  localStorage.clear();
  saved.targets = {};
});
afterEach(cleanup);

describe("existing genre playlists", () => {
  it("badges each card: update (with the target's name) or new", async () => {
    renderPreview([playlist("p1", "Rock (Playlist Splitter)"), playlist("x", "Pop (Playlist Splitter)", "someone")]);
    await settle();
    const rock = within(cardOf("Rock")).getByText("Atualizar");
    expect(rock.getAttribute("title")).toBe("Acrescenta as faixas que faltam em “Rock (Playlist Splitter)”");
    // another account's playlist doesn't count
    const pop = within(cardOf("Pop")).getByText("Nova");
    expect(pop.getAttribute("title")).toBe("Cria a playlist “Pop (Playlist Splitter)”");
  });

  it("uses the saved id for a renamed playlist", async () => {
    saved.targets = { Jazz: "p9" };
    renderPreview([playlist("p9", "Jazz da madrugada")]);
    await settle();
    expect(within(cardOf("Jazz")).getByText("Atualizar").getAttribute("title")).toContain("“Jazz da madrugada”");
  });

  it("splits the footer and checks existing or new genres only", async () => {
    const user = userEvent.setup();
    renderPreview([playlist("p1", "Rock (Playlist Splitter)")]);
    await settle();
    expect(footer().textContent).toBe("Atualizar 1 · Criar 2 · 15 faixas");

    await user.click(screen.getByRole("button", { name: "Marcar existentes" }));
    await settle();
    expect(footer().textContent).toBe("Atualizar 1 playlist");

    await user.click(screen.getByRole("button", { name: "Marcar novos" }));
    await settle();
    expect(footer().textContent).toBe("Criar 2 playlists · 9 faixas");
  });

  it("disables the buttons that would check nothing", async () => {
    renderPreview([]);
    await settle();
    expect((screen.getByRole("button", { name: "Marcar existentes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Marcar novos" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("lists updates and creations separately in the confirmation", async () => {
    const user = userEvent.setup();
    renderPreview([playlist("p1", "Rock (Playlist Splitter)")]);
    await settle();
    await user.click(footer());
    await settle();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe("Atualizar 1 · Criar 2");
    const update = within(dialog).getByRole("region", { name: "Serão atualizadas (1)" });
    const create = within(dialog).getByRole("region", { name: "Serão criadas (2)" });
    expect(within(update).getByText("Rock (Playlist Splitter)")).toBeTruthy();
    expect(within(update).getByText(/Destino: “Rock \(Playlist Splitter\)”/)).toBeTruthy();
    expect(within(create).getByText("Pop (Playlist Splitter)")).toBeTruthy();
    expect(within(create).getByText("Jazz (Playlist Splitter)")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Confirmar e criar" })).toBeTruthy();
  });

  it("says 'Atualizar N playlists' when nothing is new", async () => {
    const user = userEvent.setup();
    renderPreview([
      playlist("p1", "Rock (Playlist Splitter)"),
      playlist("p2", "Pop (Playlist Splitter)"),
      playlist("p3", "Jazz (Playlist Splitter)"),
    ]);
    await settle();
    expect(footer().textContent).toBe("Atualizar 3 playlists");
    await user.click(footer());
    await settle();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("region", { name: /Serão criadas/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Atualizar 3 playlists" })).toBeTruthy();
  });
});
