// Setup guide. Works without login and without any environment variable: it never imports
// auth.ts and only reads whether each variable is present. The text lives in ./guide.tsx.

import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { envPresence, missingEnv } from "@/lib/env-check";
import { DEFAULT_LOCALE, translate } from "@/lib/i18n";
import { CheckingText, CommonErrors, GoToApp, SetupGuide, SetupHeader, TopNav } from "./guide";

export const metadata: Metadata = { title: translate(DEFAULT_LOCALE, "setup.docTitle") };

async function Guide() {
  await connection();
  return <SetupGuide present={envPresence()} devServer={process.env.NODE_ENV !== "production"} />;
}

// The app is reachable only when no required variable is missing; until then the proxy sends
// "/" back here, so no link to "/" is rendered (it would loop)
async function appReady() {
  await connection();
  return missingEnv().length === 0;
}

async function ReadyTopNav() {
  return <TopNav ready={await appReady()} />;
}

async function ReadyGoToApp() {
  return <GoToApp ready={await appReady()} />;
}

export default function SetupPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3">
        {/* until the check streams in, nothing links to "/" */}
        <Suspense fallback={<TopNav ready={false} />}>
          <ReadyTopNav />
        </Suspense>
        <SetupHeader />
      </header>

      <Suspense fallback={<CheckingText />}>
        <Guide />
      </Suspense>

      <CommonErrors />

      <div className="flex flex-col gap-2 border-t border-fio pt-6">
        <Suspense fallback={<GoToApp ready={false} />}>
          <ReadyGoToApp />
        </Suspense>
      </div>
    </main>
  );
}
