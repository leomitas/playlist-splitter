"use client";

// Logged-out screens: step 1, what the app does, one action. Client side so the text follows
// the chosen language; the server actions (login/logout) come in as props.

import Link from "next/link";
import { setupHref, type KnownErrorId } from "@/lib/known-errors";
import { genreColor } from "./genre-colors";
import { useI18n, useRevealText } from "./i18n";
import { Preferences } from "./preferences";
import { SetupLink } from "./setup-link";
import { LocalhostWarning } from "./setup/setup-client";
import { Steps } from "./steps";

type Action = () => Promise<void>;

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-erro/50 bg-erro/10 p-3 text-sm text-erro break-words" role="alert">
      {children}
    </div>
  );
}

// Illustration only: what a library looks like once split (not the user's data)
const SAMPLE: [genre: string, share: number][] = [
  ["Rock", 24],
  ["Pop", 18],
  ["MPB", 14],
  ["Indie", 11],
  ["Hip-hop/Rap", 9],
  ["Eletrônica", 8],
  ["Jazz", 6],
  ["Pagode/Samba", 5],
  ["Outros", 5],
];

function Welcome({ children }: { children: React.ReactNode }) {
  const { t, genre } = useI18n();
  useRevealText();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <Steps current={1} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Preferences />
          <SetupLink />
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <h1 className="wide text-5xl leading-[0.95] sm:text-7xl">Playlist Splitter</h1>
        <p className="max-w-[44ch] text-lg text-areia sm:text-xl">{t("welcome.tagline")}</p>
      </div>
      <div className="flex flex-col gap-2" aria-hidden>
        <div className="h-3 rounded-full bg-papel/90" />
        <div className="split-in flex h-14 gap-0.5 overflow-hidden rounded-lg sm:h-16">
          {SAMPLE.map(([id, share], i) => (
            <div
              key={id}
              className="flex min-w-0 items-end px-2 pb-1.5"
              style={{ flexGrow: share, flexBasis: 0, background: genreColor(id) }}
            >
              {i < 4 && (
                <span className={`truncate text-xs font-bold text-cafe sm:text-sm ${i === 3 ? "hidden sm:inline" : ""}`}>
                  {genre(id)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-start gap-4">{children}</div>
    </div>
  );
}

function LoginButton({ action, again }: { action: Action; again?: boolean }) {
  const { t } = useI18n();
  return (
    <form action={action}>
      <button className="rounded-full bg-papel px-7 py-3.5 text-lg font-bold text-cafe transition-opacity hover:opacity-90">
        {again ? t("login.again") : t("login.button")}
      </button>
    </form>
  );
}

// error: the Auth.js code from ?error=; known: the matching entry of the common errors
export function LoginScreen({
  login,
  error,
  known,
  redirectUri,
}: {
  login: Action;
  error?: string;
  known: KnownErrorId | null;
  redirectUri: string;
}) {
  const { t, rich } = useI18n();
  return (
    <Welcome>
      <LocalhostWarning />
      {error && (
        <ErrorBox>
          {rich("login.failed", { code: error })}
          {known && (
            <span className="mt-1.5 block text-papel">
              {rich("login.cause", { title: t(`knownError.${known}.title`), fix: t(`knownError.${known}.fix`) })}{" "}
              <Link href={setupHref({ id: known })} className="underline underline-offset-2">
                {t("common.seeInSetup")}
              </Link>
            </span>
          )}
        </ErrorBox>
      )}
      <LoginButton action={login} />
      <p className="text-xs text-areia">
        {t("login.redirectUri")} <code className="break-all">{redirectUri}</code>
      </p>
    </Welcome>
  );
}

export function RefreshFailedScreen({ login }: { login: Action }) {
  const { t } = useI18n();
  return (
    <Welcome>
      <ErrorBox>{t("login.refreshFailed")}</ErrorBox>
      <LoginButton action={login} again />
    </Welcome>
  );
}

export function LogoutButton({ action }: { action: Action }) {
  const { t } = useI18n();
  return (
    <form action={action}>
      <button className="rounded-full border border-fio px-3 py-1 text-sm text-areia transition-colors hover:border-areia hover:text-papel">
        {t("logout")}
      </button>
    </form>
  );
}

export function LoadingText() {
  const { t } = useI18n();
  return <p className="text-areia">{t("common.loading")}</p>;
}
