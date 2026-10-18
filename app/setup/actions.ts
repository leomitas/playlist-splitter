"use server";

import { runConfigTest, type Check } from "@/lib/config-test";

// Local development only: in production the action does nothing. Never logs or returns values.
export async function testConfiguration(): Promise<{ available: false } | { available: true; checks: Check[] }> {
  if (process.env.NODE_ENV === "production") return { available: false };
  return { available: true, checks: await runConfigTest(process.env) };
}
