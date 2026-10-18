// Inline script for the root layout's <head>: runs while the HTML is parsed, before the first
// paint, so the page never flashes the wrong theme. Kept tiny and self-contained (no imports at
// runtime); app/theme.ts takes over after hydration with the same keys.

export const THEME_KEY = "theme";
export const LIGHT_QUERY = "(prefers-color-scheme: light)";

export const BOOT_SCRIPT = `(function(){var d=document.documentElement,t;try{t=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}if(t!=="light"&&t!=="dark")t=window.matchMedia&&matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark";d.setAttribute("data-theme",t)})()`;
