// Theme choice (light, dark or the system's), kept in localStorage. The head script
// (app/boot-script.ts) applies it before the first paint; this store keeps <html data-theme>
// in step afterwards, including when the system theme changes while "system" is chosen.

import { LIGHT_QUERY, THEME_KEY } from "./boot-script";

export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const isChoice = (v: unknown): v is ThemeChoice => v === "light" || v === "dark" || v === "system";

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isChoice(v) ? v : "system";
  } catch {
    return "system";
  }
}

const systemQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(LIGHT_QUERY) : null);

export function resolveTheme(choice: ThemeChoice): Theme {
  if (choice !== "system") return choice;
  return systemQuery()?.matches ? "light" : "dark";
}

const listeners = new Set<() => void>();
let current: ThemeChoice | null = null;

const apply = (choice: ThemeChoice) => document.documentElement.setAttribute("data-theme", resolveTheme(choice));
const notify = () => listeners.forEach((l) => l());

function onSystemChange() {
  if (themeStore.get() !== "system") return;
  apply("system");
  notify();
}

export const themeStore = {
  get(): ThemeChoice {
    if (current === null) current = readChoice();
    return current;
  },
  set(choice: ThemeChoice) {
    current = choice;
    try {
      if (choice === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, choice);
    } catch {
      // storage blocked: the choice lasts for this page load
    }
    apply(choice);
    notify();
  },
  subscribe(l: () => void) {
    if (listeners.size === 0) systemQuery()?.addEventListener("change", onSystemChange);
    listeners.add(l);
    return () => {
      listeners.delete(l);
      if (listeners.size === 0) systemQuery()?.removeEventListener("change", onSystemChange);
    };
  },
  // tests: forget the cached choice
  reset() {
    current = null;
  },
};
