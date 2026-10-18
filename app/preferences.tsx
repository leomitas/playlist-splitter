"use client";

import { useSyncExternalStore } from "react";
import { Segmented } from "./segmented";
import { themeStore, type ThemeChoice } from "./theme";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

// The server doesn't know the stored choice: it renders "system" and the store takes over
// after hydration (the colors themselves were already applied by the head script)
export function ThemeToggle() {
  const choice = useSyncExternalStore(themeStore.subscribe, themeStore.get, () => "system" as const);
  return <Segmented label="Tema" options={THEMES} value={choice} onChange={themeStore.set} small />;
}

// Header controls shared by every page
export function Preferences() {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2">
      <ThemeToggle />
    </div>
  );
}
