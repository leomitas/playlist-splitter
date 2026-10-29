// Interface language. The head script (app/boot-script.ts) already put it in <html lang>
// (saved choice or navigator.language); this store reads it from there and saves the user's
// explicit choice in localStorage.

import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";
import { LANG_KEY } from "./boot-script";

const listeners = new Set<() => void>();
let current: Locale | null = null;

export const localeStore = {
  get(): Locale {
    if (current === null) {
      const lang = typeof document === "undefined" ? "" : document.documentElement.lang;
      current = isLocale(lang) ? lang : DEFAULT_LOCALE;
    }
    return current;
  },
  set(locale: Locale) {
    current = locale;
    try {
      localStorage.setItem(LANG_KEY, locale);
    } catch {
      // storage blocked: the choice lasts for this page load
    }
    document.documentElement.lang = locale;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  // tests: forget the cached locale
  reset() {
    current = null;
  },
};
