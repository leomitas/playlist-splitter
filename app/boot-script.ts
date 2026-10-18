// Inline script for the root layout's <head>: runs while the HTML is parsed, before the first
// paint. It applies the theme (no flash of the wrong colors) and the language: <html lang>
// from the saved choice or, on a first visit, from navigator.language. The server renders
// Portuguese, so for any other language the body stays hidden (I18N_PENDING) until the page
// has re-rendered in it (app/i18n.tsx, useRevealText), with a timeout as a safety net.
// Kept tiny and self-contained; app/theme.ts and app/locale.ts take over with the same keys.

export const THEME_KEY = "theme";
export const LIGHT_QUERY = "(prefers-color-scheme: light)";
export const LANG_KEY = "lang";
export const I18N_PENDING = "data-i18n-pending";
const REVEAL_TIMEOUT_MS = 2000;

export const BOOT_SCRIPT = `(function(){var d=document.documentElement,t,l;try{t=localStorage.getItem(${JSON.stringify(THEME_KEY)});l=localStorage.getItem(${JSON.stringify(LANG_KEY)})}catch(e){}if(t!=="light"&&t!=="dark")t=window.matchMedia&&matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark";d.setAttribute("data-theme",t);if(l!=="pt-BR"&&l!=="en")l=/^pt\\b/i.test(navigator.language||"")?"pt-BR":"en";d.lang=l;if(l!=="pt-BR"){d.setAttribute(${JSON.stringify(I18N_PENDING)},"");setTimeout(function(){d.removeAttribute(${JSON.stringify(I18N_PENDING)})},${REVEAL_TIMEOUT_MS})}})()`;
