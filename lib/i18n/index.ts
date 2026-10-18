// Translation core, no React: the dictionaries, plural selection, interpolation and Intl
// formatting. app/i18n.tsx wraps it in a hook for the components.
//
// Entries are strings or plural objects. Placeholders are {name}; numbers passed as
// variables are formatted for the locale. Markup tags (<b>…</b>, <code>…</code>, <link>…</link>)
// are only parsed by `rich` in app/i18n.tsx. Plurals pick a form with Intl.PluralRules on
// {count}; a count of 0 uses `zero` when the entry has it and `other` otherwise (Intl gives
// "one" for 0 in Portuguese, which reads as "0 faixa").

import { en } from "./en";
import { pt } from "./pt-BR";

export const LOCALES = ["pt-BR", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-BR";

export type Plural = { one: string; other: string; zero?: string };
export type Entry = string | Plural;
export type Key = keyof typeof pt;
export type Dict = Record<Key, Entry>;
export type Vars = Record<string, string | number>;

export const DICTS: Record<Locale, Dict> = { "pt-BR": pt, en };

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

// "pt", "pt-PT", "pt-BR" -> pt-BR; anything else -> en
export const localeFromLanguage = (lang: string | null | undefined): Locale => (/^pt\b/i.test(lang ?? "") ? "pt-BR" : "en");

const cache = new Map<string, Intl.PluralRules | Intl.NumberFormat | Intl.ListFormat>();
function memo<T extends Intl.PluralRules | Intl.NumberFormat | Intl.ListFormat>(id: string, make: () => T): T {
  let v = cache.get(id) as T | undefined;
  if (!v) cache.set(id, (v = make()));
  return v;
}

export const formatNumber = (locale: Locale, n: number) => memo(`n:${locale}`, () => new Intl.NumberFormat(locale)).format(n);

export const formatList = (locale: Locale, items: string[]) =>
  memo(`l:${locale}`, () => new Intl.ListFormat(locale, { style: "long", type: "conjunction" })).format(items);

export function pluralForm(locale: Locale, entry: Plural, count: number): string {
  if (count === 0) return entry.zero ?? entry.other;
  const rule = memo(`p:${locale}`, () => new Intl.PluralRules(locale)).select(count);
  return rule === "one" ? entry.one : entry.other;
}

// The template for a key, plural already chosen
export function template(locale: Locale, key: Key, vars?: Vars): string {
  const entry = DICTS[locale][key] ?? DICTS[DEFAULT_LOCALE][key];
  if (typeof entry === "string") return entry;
  return pluralForm(locale, entry, Number(vars?.count ?? 0));
}

export function interpolate(locale: Locale, text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined) return whole;
    return typeof v === "number" ? formatNumber(locale, v) : v;
  });
}

// Plain text; markup tags are dropped (their content stays)
export function translate(locale: Locale, key: Key, vars?: Vars): string {
  return interpolate(locale, template(locale, key, vars), vars).replace(/<\/?\w+>/g, "");
}

// Family names that read differently per language; the family id stays the stable key
// (groups, caches, exports). Families without an entry are shown as they are.
export function genreName(locale: Locale, familyId: string): string {
  const key = `genre.${familyId}`;
  return key in DICTS[locale] ? (DICTS[locale][key as Key] as string) : familyId;
}
