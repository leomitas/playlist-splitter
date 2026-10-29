// Missing required variables: pages go to /setup (which lists what's missing), API routes answer
// 503. The redirect is built from the Host header, not req.nextUrl: NextRequest rewrites
// 127.0.0.1 to "localhost", which would move the browser to another origin.

import type { NextRequest } from "next/server";
import { missingEnv } from "@/lib/env-check";

export function proxy(req: NextRequest) {
  const missing = missingEnv();
  if (missing.length === 0) return;

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return Response.json(
      {
        ok: false,
        url: req.nextUrl.pathname,
        status: 503,
        code: "config-missing",
        vars: { missing: missing.join(", ") },
        raw: `Missing configuration: ${missing.join(", ")}. See /setup.`,
      },
      { status: 503 },
    );
  }
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const location = new URL(`/setup?missing=${missing.join(",")}`, `${req.nextUrl.protocol}//${host}`);
  return Response.redirect(location, 307);
}

export const config = {
  // /setup and static assets always load
  matcher: ["/((?!setup|_next/|icon\\.svg|favicon\\.ico).*)"],
};
