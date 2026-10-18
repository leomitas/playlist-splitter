// @vitest-environment jsdom
// Theme: the inline head script (no flash), the store's persistence and the header toggle.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_SCRIPT } from "@/app/boot-script";
import { ThemeToggle } from "@/app/preferences";
import { localeStore } from "@/app/locale";
import { themeStore } from "@/app/theme";

vi.mock("next/font/google", () => ({ Archivo: () => ({ variable: "f1" }), Atkinson_Hyperlegible: () => ({ variable: "f2" }) }));

// a controllable prefers-color-scheme
let systemLight = false;
const mediaListeners = new Set<() => void>();
function setSystem(light: boolean) {
  systemLight = light;
  mediaListeners.forEach((l) => l());
}

beforeEach(() => {
  localStorage.clear();
  themeStore.reset();
  // the head script also sets the language (jsdom reports en-US); these tests read Portuguese
  document.documentElement.lang = "pt-BR";
  localeStore.reset();
  document.documentElement.removeAttribute("data-theme");
  systemLight = false;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("light") && systemLight;
    },
    addEventListener: (_: string, l: () => void) => mediaListeners.add(l),
    removeEventListener: (_: string, l: () => void) => mediaListeners.delete(l),
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const runBoot = () => new Function(BOOT_SCRIPT)();
const theme = () => document.documentElement.getAttribute("data-theme");

describe("head script", () => {
  it("is inline, synchronous and first in <head>, before any body content", async () => {
    const { default: RootLayout } = await import("@/app/layout");
    const html = renderToStaticMarkup(RootLayout({ children: <p>conteúdo</p> } as never));
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head.startsWith("<head><script>")).toBe(true);
    expect(head).toContain(BOOT_SCRIPT);
    expect(head).not.toMatch(/<script[^>]*(async|defer|type="module"|src=)/);
    expect(html.indexOf(BOOT_SCRIPT)).toBeLessThan(html.indexOf("<body"));
  });

  it("applies the saved choice synchronously", () => {
    localStorage.setItem("theme", "light");
    runBoot();
    expect(theme()).toBe("light");
    localStorage.setItem("theme", "dark");
    systemLight = true;
    runBoot();
    expect(theme()).toBe("dark");
  });

  it("without a choice, follows prefers-color-scheme", () => {
    systemLight = true;
    runBoot();
    expect(theme()).toBe("light");
    systemLight = false;
    runBoot();
    expect(theme()).toBe("dark");
  });

  it("survives a blocked localStorage and an invalid value", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    systemLight = true;
    expect(runBoot).not.toThrow();
    expect(theme()).toBe("light");
    spy.mockRestore();
    localStorage.setItem("theme", "sepia");
    systemLight = false;
    runBoot();
    expect(theme()).toBe("dark");
  });
});

describe("theme store", () => {
  it("saves light/dark, and system removes the saved choice", () => {
    themeStore.set("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(theme()).toBe("light");
    themeStore.set("system");
    expect(localStorage.getItem("theme")).toBeNull();
    expect(theme()).toBe("dark");
  });

  it("reads the saved choice back after a reload", () => {
    localStorage.setItem("theme", "dark");
    expect(themeStore.get()).toBe("dark");
  });

  it("follows a system change only while system is chosen", () => {
    const unsubscribe = themeStore.subscribe(() => {});
    themeStore.set("system");
    setSystem(true);
    expect(theme()).toBe("light");
    themeStore.set("dark");
    setSystem(false);
    setSystem(true);
    expect(theme()).toBe("dark");
    unsubscribe();
  });
});

describe("ThemeToggle", () => {
  it("is a segmented control that applies and saves the choice", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const radio = (name: string) => screen.getByRole("radio", { name });
    expect(radio("Sistema").getAttribute("aria-checked")).toBe("true");
    await user.click(radio("Claro"));
    expect(theme()).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(radio("Claro").getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(theme()).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});
