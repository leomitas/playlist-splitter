"use client";

import { useCallback } from "react";

// Callback ref that publishes the element's height as a CSS variable on <html> (0px once it's
// gone), so the desktop sidebar can fit between the sticky header and the fixed bottom bar
// whatever their real height (quota banner, wrapped text)
export function useHeightVar(name: `--${string}`) {
  return useCallback(
    (el: HTMLElement | null) => {
      const root = document.documentElement.style;
      if (!el) return;
      const update = () => root.setProperty(name, `${el.offsetHeight}px`);
      update();
      // jsdom (tests) has no ResizeObserver: the first measure is enough there
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => {
        observer.disconnect();
        root.setProperty(name, "0px");
      };
    },
    [name],
  );
}
