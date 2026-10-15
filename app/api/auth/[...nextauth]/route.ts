import { Auth, setEnvDefaults } from "@auth/core";
import type { NextRequest } from "next/server";
import { authConfig } from "@/auth";

setEnvDefaults(process.env, authConfig);

// next-auth's own handlers wrap the request in a NextRequest, which rewrites
// 127.0.0.1 to "localhost". Spotify only accepts the 127.0.0.1 redirect URI,
// so we rebuild a plain Request on AUTH_URL and hand it to Auth.js directly.
async function handler(req: NextRequest) {
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, process.env.AUTH_URL);
  const body = req.method === "POST" ? await req.text() : undefined;
  return Auth(new Request(url, { method: req.method, headers: req.headers, body }), authConfig);
}

export { handler as GET, handler as POST };
