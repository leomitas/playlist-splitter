"use client";

// The components' side of lib/i18n: useI18n() gives the current locale's t(), rich() (text
// with <b>/<code>/<link>… rendered by the caller), number and list formatting and the display
// helpers (genre names, low-confidence reasons, app errors). The server renders the default
// locale; after hydration the store's locale takes over.

import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { lowConfidenceReason } from "@/lib/classify";
import {
  DEFAULT_LOCALE,
  formatList,
  formatNumber,
  genreName,
  interpolate,
  template,
  translate,
  type Key,
  type Locale,
  type Vars,
} from "@/lib/i18n";
import { formatBlockEnd } from "@/lib/quota-block";
import type { ApiError } from "@/lib/spotify";
import { I18N_PENDING } from "./boot-script";
import { localeStore } from "./locale";

export type Tags = Record<string, (chunk: string) => ReactNode>;

// Splits the template on its tags first and interpolates after, so a variable holding "<b>"
// (a track name, say) stays text
function richText(locale: Locale, key: Key, vars: Vars | undefined, tags: Tags): ReactNode {
  const source = template(locale, key, vars);
  const out: ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m.index > last) out.push(interpolate(locale, source.slice(last, m.index), vars));
    const render = tags[m[1]];
    const inner = interpolate(locale, m[2], vars);
    out.push(<Fragment key={out.length}>{render ? render(inner) : inner}</Fragment>);
    last = re.lastIndex;
  }
  if (last < source.length) out.push(interpolate(locale, source.slice(last), vars));
  return out;
}

// Tags most texts use; callers add or override (links need their href)
const BASE_TAGS: Tags = {
  b: (c) => <strong>{c}</strong>,
  code: (c) => <code>{c}</code>,
};

function makeI18n(locale: Locale) {
  const t = (key: Key, vars?: Vars) => translate(locale, key, vars);
  const genre = (familyId: string) => genreName(locale, familyId);
  return {
    locale,
    t,
    rich: (key: Key, vars?: Vars, tags: Tags = {}) => richText(locale, key, vars, { ...BASE_TAGS, ...tags }),
    n: (value: number) => formatNumber(locale, value),
    list: (items: string[]) => formatList(locale, items),
    genre,
    // a group keeps the family id as its name until the user renames it
    groupName: (g: { id: string; name: string }) => (g.name === g.id ? genre(g.id) : g.name),
    lowReason(reason: string) {
      const r = lowConfidenceReason(reason);
      if (r.kind === "incoherent") return t("lowConfidence.incoherent");
      if (r.kind === "corrected") return t("lowConfidence.corrected", { artist: r.artist });
      return r.text;
    },
    // message for an error the app produced (code), or null for a raw API answer
    appError(e: Pick<ApiError, "code" | "vars" | "blockedUntil">) {
      if (!e.code) return null;
      const time = e.blockedUntil ? formatBlockEnd(e.blockedUntil, Date.now(), locale) : "";
      return t(`apiError.${e.code}` as const, { time, ...e.vars });
    },
  };
}

export type I18n = ReturnType<typeof makeI18n>;

const byLocale = new Map<Locale, I18n>();
export function i18nFor(locale: Locale): I18n {
  let v = byLocale.get(locale);
  if (!v) byLocale.set(locale, (v = makeI18n(locale)));
  return v;
}

const serverLocale = () => DEFAULT_LOCALE;

export function useI18n(): I18n {
  return i18nFor(useSyncExternalStore(localeStore.subscribe, localeStore.get, serverLocale));
}

// Called by each page's main client component: once it has rendered in the visitor's
// language, the body hidden by the head script can show
export function useRevealText() {
  const { locale } = useI18n();
  useEffect(() => {
    if (locale === localeStore.get()) document.documentElement.removeAttribute(I18N_PENDING);
  }, [locale]);
}
