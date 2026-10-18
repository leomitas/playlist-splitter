// Every visible text in app/ comes from the dictionaries. Walks each file's syntax tree and
// flags: JSX text with letters, literal values of visible attributes (aria-label, title,
// placeholder, alt, label), and any other string that looks Portuguese (accents, common
// Portuguese words, or a word that only the Portuguese dictionary uses).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FUNK_UNCERTAIN, GENRE_FAMILIES, GRINGO_FUNK, OTHER } from "@/lib/genre-families";
import { en } from "@/lib/i18n/en";
import { pt } from "@/lib/i18n/pt-BR";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const APP = join(ROOT, "app");

// Text that is the same in every language, and the family ids: they're keys (colors, sample
// data, groups), shown through genre() which translates them
const ALLOWED_TEXT = new Set([
  "Playlist Splitter",
  "Playlist Splitter (local)",
  "Spotify",
  "Last.fm",
  "MusicBrainz",
  ...Object.keys(GENRE_FAMILIES),
  OTHER,
  FUNK_UNCERTAIN,
  GRINGO_FUNK,
]);

// Attributes that never hold text (anchors, links, keys)
const NON_TEXT_ATTRIBUTES = new Set(["id", "href", "key", "name", "htmlFor", "type", "role", "lang", "rel", "target", "src"]);

// State codes kept in Portuguese because they're persisted (IndexedDB, localStorage) or compared
// across modules; they're never shown as is: the UI translates them (itemStatus.*, setup.status.*,
// untaggedReason.*, create.status.*)
const STATE_CODES = new Set([
  "pendente",
  "analisando",
  "concluída",
  "erro",
  "cancelada",
  "lendo",
  "gêneros",
  "faixas",
  "entrada inválida",
  "erro do Last.fm",
  "aguardando",
  "criando",
  "adicionando",
  "criada",
  "atualizada",
  "nada novo",
  "não criada",
  "atenção",
]);

const VISIBLE_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt", "label", "aria-description"]);
const ACCENTS = /[áàâãéêíóôõúüç]/i;
const PT_WORDS = /\b(de|da|do|das|dos|para|com|sem|não|uma|por|que|seu|sua|até|ou|são|está|já|só|mais|menos|nenhum|nenhuma)\b/i;

const words = (s: string) => s.toLowerCase().match(/[a-zà-ü]{4,}/g) ?? [];
const values = (dict: Record<string, unknown>) =>
  Object.values(dict).flatMap((e) => (typeof e === "string" ? [e] : Object.values(e as Record<string, string>)));
// words only Portuguese uses ("claro", "escuro", "tamanho"...), minus placeholders and tags
const enWords = new Set(values(en).flatMap(words));
const PT_ONLY = new Set(
  values(pt)
    .map((s) => s.replace(/\{\w+\}|<\/?\w+>/g, " "))
    .flatMap(words)
    .filter((w) => !enWords.has(w)),
);

// Tailwind class lists and other identifier-like strings ("text-erro", "bg-papel/90")
const looksLikeClasses = (s: string) =>
  s.split(/\s+/).filter(Boolean).every((tok) => /^[a-z0-9:/[\]().%!_#&>*=@,-]+$/i.test(tok)) && /[-:]/.test(s);

function looksPortuguese(s: string) {
  const text = s.trim();
  if (!text || STATE_CODES.has(text) || ALLOWED_TEXT.has(text) || looksLikeClasses(text)) return false;
  return ACCENTS.test(text) || PT_WORDS.test(text) || words(text).some((w) => PT_ONLY.has(w));
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

type Finding = { file: string; line: number; text: string; why: string };

function scan(path: string): Finding[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];
  const report = (node: ts.Node, text: string, why: string) =>
    found.push({ file: relative(ROOT, path), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text, why });

  function visit(node: ts.Node) {
    // module specifiers, directives and comments aren't text
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)) return;

    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/g, " ").trim();
      if (/\p{L}/u.test(text) && !ALLOWED_TEXT.has(text)) report(node, text, "JSX text");
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText();
      const value = node.initializer.text;
      if (name === "className" || NON_TEXT_ATTRIBUTES.has(name)) return;
      if (VISIBLE_ATTRIBUTES.has(name) && /\p{L}/u.test(value) && !ALLOWED_TEXT.has(value)) report(node, value, name);
      else if (looksPortuguese(value)) report(node, value, `${name} attribute`);
      return;
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (looksPortuguese(node.text)) report(node, node.text, "string");
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
      if (looksPortuguese(parts)) report(node, node.getText(), "template");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

describe("no hardcoded text in app/", () => {
  it("every visible text goes through the dictionaries", () => {
    const findings = files(APP).flatMap(scan);
    // one line per finding, so a failure lists them all
    expect(findings.map((f) => `${f.file}:${f.line} (${f.why}) ${f.text}`).join("\n")).toBe("");
  });

  it("the scanner catches what it should (sanity check on a fake component)", () => {
    const fake = join(ROOT, "tests", "fixtures", "hardcoded.tsx");
    const why = scan(fake).map((f) => f.why);
    expect(why.join(", ")).toBe("string, JSX text, aria-label, placeholder, template, string");
  });
});
