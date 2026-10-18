"use client";

import { useSyncExternalStore } from "react";
import { LOCALES, type Locale } from "@/lib/i18n";
import { useI18n } from "./i18n";
import { localeStore } from "./locale";
import { Segmented } from "./segmented";
import { themeStore, type ThemeChoice } from "./theme";

const THEMES: ThemeChoice[] = ["light", "dark", "system"];
const SHORT: Record<Locale, string> = { "pt-BR": "PT", en: "EN" };

// The server doesn't know the stored choice: it renders "system" and the store takes over
// after hydration (the colors themselves were already applied by the head script)
export function ThemeToggle() {
  const { t } = useI18n();
  const choice = useSyncExternalStore(themeStore.subscribe, themeStore.get, () => "system" as const);
  return (
    <Segmented
      label={t("prefs.theme")}
      options={THEMES.map((value) => ({ value, label: t(`prefs.theme.${value}`) }))}
      value={choice}
      onChange={themeStore.set}
      small
    />
  );
}

// PT | EN; each option is announced by the language's own name
export function LocaleToggle() {
  const { t, locale } = useI18n();
  return (
    <Segmented
      label={t("prefs.language")}
      options={LOCALES.map((value) => ({
        value,
        label: (
          <>
            <span aria-hidden>{SHORT[value]}</span>
            <span className="sr-only" lang={value}>
              {t(`prefs.language.${value}`)}
            </span>
          </>
        ),
      }))}
      value={locale}
      onChange={localeStore.set}
      small
    />
  );
}

// Header controls shared by every page
export function Preferences() {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2">
      <LocaleToggle />
      <ThemeToggle />
    </div>
  );
}
