// npm run doctor — checks .env.local and the dev host/port without printing any value.
// Exit code 1 when something must be fixed.

import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { LOCAL_URL, parseEnv, REQUIRED } from "./env-file.mjs";

const root = process.cwd();
let errors = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const warn = (msg) => console.log(`  aviso ${msg}`);
const fail = (msg) => {
  errors++;
  console.log(`  ERRO  ${msg}`);
};

console.log("Playlist Splitter: diagnóstico\n");

const localPath = join(root, ".env.local");
if (!existsSync(localPath)) {
  fail(".env.local não existe. Rode npm run setup:env.");
} else {
  const env = parseEnv(readFileSync(localPath, "utf8"));
  for (const k of REQUIRED) (env[k]?.trim() ? ok : fail)(`${k} ${env[k]?.trim() ? "definida" : "vazia ou ausente"}`);

  if (env.AUTH_URL?.trim()) {
    const url = env.AUTH_URL.trim().replace(/\/$/, "");
    if (url === LOCAL_URL) ok(`AUTH_URL é ${LOCAL_URL}`);
    else if (/localhost/i.test(url)) fail(`AUTH_URL usa localhost; use ${LOCAL_URL} (o Spotify não aceita localhost).`);
    else fail(`AUTH_URL deve ser exatamente ${LOCAL_URL} (host 127.0.0.1, porta 3000).`);
  }
  if (env.AUTH_SECRET?.trim() && env.AUTH_SECRET.trim().length < 32) fail("AUTH_SECRET curto (menos de 32 caracteres). Apague e rode npm run setup:env.");
  if (env.AUTH_SPOTIFY_ID?.trim() && !/^[0-9a-f]{32}$/i.test(env.AUTH_SPOTIFY_ID.trim()))
    warn("AUTH_SPOTIFY_ID não parece um Client ID (32 caracteres hexadecimais). Confira se não colou o secret ou espaços.");
  if (env.LASTFM_API_KEY?.trim() && !/^[0-9a-f]{32}$/i.test(env.LASTFM_API_KEY.trim()))
    warn("LASTFM_API_KEY não parece uma API key do Last.fm (32 caracteres hexadecimais).");
}

const gitignore = join(root, ".gitignore");
if (existsSync(gitignore) && /^\.env\*?$|^\.env\.local$/m.test(readFileSync(gitignore, "utf8"))) ok(".env.local está no .gitignore");
else fail(".env.local não está no .gitignore. Adicione .env* antes de commitar.");

try {
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
  if (/-H\s+127\.0\.0\.1/.test(scripts.dev ?? "") && /-p\s+3000\b/.test(scripts.dev ?? "")) ok("npm run dev escuta em 127.0.0.1:3000");
  else fail('O script "dev" deve ser: next dev -H 127.0.0.1 -p 3000');
} catch {
  fail("Não consegui ler o package.json.");
}

// a server already on the port: fine if it's this app, but it only picks up .env.local changes on restart
const listening = await new Promise((resolve) => {
  const s = createConnection({ host: "127.0.0.1", port: 3000 });
  s.setTimeout(800);
  s.once("connect", () => (s.destroy(), resolve(true)));
  s.once("timeout", () => (s.destroy(), resolve(false)));
  s.once("error", () => resolve(false));
});
if (listening) warn("Já há um servidor em 127.0.0.1:3000. Se mudou o .env.local, pare-o e rode npm run dev de novo.");
else ok("Porta 3000 livre");

console.log(errors === 0 ? "\nTudo certo. Rode npm run dev e abra http://127.0.0.1:3000" : `\n${errors} problema(s). Guia completo: http://127.0.0.1:3000/setup`);
process.exit(errors === 0 ? 0 : 1);
