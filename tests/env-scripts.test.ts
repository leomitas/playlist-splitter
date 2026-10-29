import { describe, expect, it } from "vitest";
import { missing, newSecret, parseEnv, setVar } from "../scripts/env-file.mjs";

const EXAMPLE = `# comment
AUTH_SPOTIFY_ID=
AUTH_SPOTIFY_SECRET=
AUTH_SECRET=
AUTH_URL=http://127.0.0.1:3000
LASTFM_API_KEY=
`;

describe("env-file helpers (setup:env, doctor)", () => {
  it("parses KEY=VALUE, ignoring comments and quotes", () => {
    expect(parseEnv('A=1\n# B=2\nC="x y"\nD=z # note\n')).toEqual({ A: "1", C: "x y", D: "z" });
  });

  it("lists what's missing in a fresh copy of the example", () => {
    expect(missing(parseEnv(EXAMPLE))).toEqual(["AUTH_SPOTIFY_ID", "AUTH_SPOTIFY_SECRET", "AUTH_SECRET", "LASTFM_API_KEY"]);
  });

  it("fills AUTH_SECRET in place, keeping the other lines", () => {
    const secret = newSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const out = setVar(EXAMPLE, "AUTH_SECRET", secret);
    expect(parseEnv(out).AUTH_SECRET).toBe(secret);
    expect(out.split("\n")).toHaveLength(EXAMPLE.split("\n").length);
    expect(out.startsWith("# comment\n")).toBe(true);
  });

  it("appends a variable that isn't there", () => {
    expect(setVar("A=1", "B", "2")).toBe("A=1\nB=2\n");
  });
});
