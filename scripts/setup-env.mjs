// npm run setup:env — creates .env.local from .env.example (never overwrites it), fills an empty
// AUTH_SECRET with a random value and lists what's left to fill. Never prints any value.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { missing, newSecret, parseEnv, setVar } from "./env-file.mjs";

const root = process.cwd();
const example = join(root, ".env.example");
const local = join(root, ".env.local");

let text;
if (existsSync(local)) {
  console.log(".env.local já existe: não foi sobrescrito.");
  text = readFileSync(local, "utf8");
} else {
  if (!existsSync(example)) {
    console.error("Não achei .env.example. Rode o comando na pasta do projeto.");
    process.exit(1);
  }
  text = readFileSync(example, "utf8");
  console.log("Criado .env.local a partir do .env.example.");
}

if (!parseEnv(text).AUTH_SECRET?.trim()) {
  text = setVar(text, "AUTH_SECRET", newSecret());
  console.log("AUTH_SECRET gerado (valor não exibido).");
}
writeFileSync(local, text);

const left = missing(parseEnv(text));
if (left.length === 0) {
  console.log("Todas as variáveis estão preenchidas. Rode npm run doctor para conferir.");
} else {
  console.log("\nFalta preencher em .env.local:");
  for (const k of left) console.log(`  - ${k}`);
  console.log("\nPasso a passo: npm run dev e abra http://127.0.0.1:3000/setup");
}
