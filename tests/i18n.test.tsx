// @vitest-environment jsdom
// Dictionaries (same keys, placeholders, tags and plural shape), formatting, the language
// store and toggle, the head script's language part, and translated genre names.

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_SCRIPT, I18N_PENDING } from "@/app/boot-script";
import { i18nFor, useRevealText } from "@/app/i18n";
import { localeStore } from "@/app/locale";
import { LocaleToggle, ThemeToggle } from "@/app/preferences";
import { Preview } from "@/app/preview";
import { FUNK_UNCERTAIN, OTHER } from "@/lib/genre-families";
import { DICTS, genreName, translate, type Entry } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { pt } from "@/lib/i18n/pt-BR";
import { many } from "./helpers";

vi.mock("@/app/create-playlists", () => ({ CreatePlaylists: () => null }));

const html = document.documentElement;
beforeEach(() => {
  localStorage.clear();
  html.lang = "pt-BR";
  html.removeAttribute(I18N_PENDING);
  localeStore.reset();
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(cleanup);

const forms = (e: Entry) => (typeof e === "string" ? [e] : [e.one, e.other, ...(e.zero ? [e.zero] : [])]);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  it("pt-BR and en have exactly the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
  });

  it("every entry has the same shape, placeholders and tags in both languages", () => {
    for (const key of Object.keys(pt) as (keyof typeof pt)[]) {
      const [a, b] = [pt[key] as Entry, en[key]];
      expect(typeof a, key).toBe(typeof b);
      // every form of every language uses the same variables (count may be implied by the form)
      const vars = new Set([...forms(a), ...forms(b)].flatMap(placeholders).filter((v) => v !== "count"));
      for (const text of [...forms(a), ...forms(b)]) {
        expect(placeholders(text).filter((v) => v !== "count"), `${key}: ${text}`).toEqual([...vars].sort());
        expect(tags(text), `${key}: ${text}`).toEqual(tags(forms(a)[0]));
      }
    }
  });

  it("no entry is empty", () => {
    for (const dict of Object.values(DICTS)) for (const [key, e] of Object.entries(dict)) expect(forms(e).every(Boolean), key).toBe(true);
  });
});

describe("translate", () => {
  it("picks plural forms with Intl.PluralRules; zero uses the plural", () => {
    expect(translate("pt-BR", "common.tracks", { count: 1 })).toBe("1 faixa");
    expect(translate("pt-BR", "common.tracks", { count: 0 })).toBe("0 faixas");
    expect(translate("pt-BR", "common.tracks", { count: 2 })).toBe("2 faixas");
    expect(translate("en", "common.tracks", { count: 1 })).toBe("1 track");
    expect(translate("en", "common.tracks", { count: 0 })).toBe("0 tracks");
  });

  it("formats numbers per locale and drops markup in plain text", () => {
    expect(translate("pt-BR", "common.tracks", { count: 1850 })).toBe("1.850 faixas");
    expect(translate("en", "common.tracks", { count: 1850 })).toBe("1,850 tracks");
    expect(translate("en", "preview.onlyKept", { name: "Rock" })).toBe("Only Rock is checked now.");
  });

  it("formats lists per locale", () => {
    expect(i18nFor("pt-BR").list(["Outros", "Funk (incerto)"])).toBe("Outros e Funk (incerto)");
    expect(i18nFor("en").list(["Other", "Funk (uncertain)"])).toBe("Other and Funk (uncertain)");
  });

  it("rich keeps variables as text, even when they look like tags", () => {
    const out = renderToStaticMarkup(<p>{i18nFor("pt-BR").rich("preview.onlyKept", { name: "<b>x</b>" })}</p>);
    expect(out).toBe("<p>Só <strong>&lt;b&gt;x&lt;/b&gt;</strong> ficou marcado.</p>");
  });

  it("translates family names for display only; unknown families stay as they are", () => {
    expect(genreName("en", OTHER)).toBe("Other");
    expect(genreName("en", FUNK_UNCERTAIN)).toBe("Funk (uncertain)");
    expect(genreName("en", "Eletrônica")).toBe("Electronic");
    expect(genreName("en", "Rock")).toBe("Rock");
    expect(genreName("pt-BR", OTHER)).toBe("Outros");
  });

  it("reads low-confidence codes and old Portuguese reasons in the current language", () => {
    expect(i18nFor("en").lowReason("incoherent-tags")).toBe("tags outside the selection's pattern");
    expect(i18nFor("en").lowReason('Last.fm corrigiu o artista para "Seu Jorge"')).toBe('Last.fm corrected the artist to "Seu Jorge"');
  });
});

describe("language: head script", () => {
  const boot = () => new Function(BOOT_SCRIPT)();
  const setNavigator = (lang: string) => vi.spyOn(navigator, "language", "get").mockReturnValue(lang);

  it("first visit follows navigator.language; non-Portuguese hides the page until re-rendered", () => {
    setNavigator("pt-PT");
    boot();
    expect(html.lang).toBe("pt-BR");
    expect(html.hasAttribute(I18N_PENDING)).toBe(false);

    setNavigator("en-US");
    boot();
    expect(html.lang).toBe("en");
    expect(html.hasAttribute(I18N_PENDING)).toBe(true);
  });

  it("a saved choice wins over the browser language", () => {
    setNavigator("en-US");
    localStorage.setItem("lang", "pt-BR");
    boot();
    expect(html.lang).toBe("pt-BR");
  });

  it("the page is revealed once it rendered in that language", () => {
    html.lang = "en";
    html.setAttribute(I18N_PENDING, "");
    localeStore.reset();
    function Page() {
      useRevealText();
      return null;
    }
    render(<Page />);
    expect(html.hasAttribute(I18N_PENDING)).toBe(false);
  });
});

describe("language: store and toggle", () => {
  it("reads <html lang> set by the head script", () => {
    html.lang = "en";
    expect(localeStore.get()).toBe("en");
  });

  it("the PT | EN toggle switches the texts, <html lang> and saves the choice", async () => {
    const user = userEvent.setup();
    render(
      <>
        <LocaleToggle />
        <ThemeToggle />
      </>,
    );
    const language = screen.getByRole("radiogroup", { name: "Idioma" });
    expect(within(language).getByRole("radio", { name: "Português" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Claro" })).toBeTruthy();

    await user.click(within(language).getByRole("radio", { name: "English" }));
    expect(html.lang).toBe("en");
    expect(localStorage.getItem("lang")).toBe("en");
    expect(screen.getByRole("radiogroup", { name: "Language" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Light" })).toBeTruthy();

    // a reload reads it back (the head script puts it in <html lang>)
    localeStore.reset();
    expect(localeStore.get()).toBe("en");
  });
});

describe("genre names in the preview", () => {
  // "Outros" needs tracks to be shown (empty groups are hidden)
  const tracks = [
    ...many(4, { artist: "R", family: "Rock" }),
    ...many(3, { artist: "M", family: FUNK_UNCERTAIN }),
    ...many(2, { artist: "X", family: OTHER }),
  ];
  const names = () => screen.getAllByRole("textbox", { name: /Nome da playlist|Playlist name/ }).map((i) => (i as HTMLInputElement).value);

  it("shows translated family names, keeps renamed groups and the stored ids", async () => {
    const user = userEvent.setup();
    render(
      <Preview
        tracks={tracks}
        duplicates={0}
        consensus={{ inferred: 0, fromOther: 0, noLongerLow: 0 }}
        storageKey="i18n-test"
        onSpotifyChanged={() => {}}
        reorderToken={0}
      />,
    );
    expect(names()).toEqual(["Rock", "Funk (incerto)", "Outros"]);

    const rock = screen.getAllByRole("textbox", { name: "Nome da playlist" })[0];
    await user.clear(rock);
    await user.type(rock, "Meu rock");

    act(() => localeStore.set("en"));
    expect(names()).toEqual(["Meu rock", "Funk (uncertain)", "Other"]);
    expect(screen.getByRole("checkbox", { name: "Create a playlist for Other" })).toBeTruthy();
    expect(screen.getByText("Genres")).toBeTruthy();

    // what's saved keeps the family ids as names for unedited groups
    await new Promise((r) => setTimeout(r, 600));
    const saved = JSON.parse(localStorage.getItem("i18n-test")!) as { groups: { id: string; name: string }[] };
    expect(saved.groups.map((g) => g.name)).toEqual(["Meu rock", FUNK_UNCERTAIN, OTHER]);
  });
});
