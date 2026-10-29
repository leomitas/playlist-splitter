// Shared by setup-env and doctor. Reads .env files without ever printing values.

import { randomBytes } from "node:crypto";

export const REQUIRED = ["AUTH_SPOTIFY_ID", "AUTH_SPOTIFY_SECRET", "AUTH_SECRET", "AUTH_URL", "LASTFM_API_KEY"];
export const LOCAL_URL = "http://127.0.0.1:3000";

// KEY=VALUE lines; comments and blank lines ignored, surrounding quotes removed
/** @param {string} text @returns {Record<string, string>} */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    env[m[1]] = value;
  }
  return env;
}

export const missing = (env) => REQUIRED.filter((k) => !env[k]?.trim());

export const newSecret = () => randomBytes(32).toString("base64url");

// Replaces (or appends) KEY=value, keeping every other line as it is
export function setVar(text, key, value) {
  const re = new RegExp(`^(\\s*${key}\\s*=).*$`, "m");
  if (re.test(text)) return text.replace(re, `$1${value}`);
  return `${text}${text.endsWith("\n") || text === "" ? "" : "\n"}${key}=${value}\n`;
}
