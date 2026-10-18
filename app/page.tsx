import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, signIn, signOut } from "@/auth";
import { matchAuthError, setupHref } from "@/lib/known-errors";
import { genreColor } from "./genre-colors";
import { LocalhostWarning } from "./setup/setup-client";
import { SpotifyApp } from "./spotify-app";
import { Steps } from "./steps";

async function login() {
  "use server";
  const url: string = await signIn("spotify", { redirect: false, redirectTo: "/" });
  console.log(
    "[auth] redirect_uri enviada ao Spotify:",
    new URL(url).searchParams.get("redirect_uri"),
  );
  redirect(url);
}

async function logout() {
  "use server";
  await signOut({ redirectTo: "/" });
}

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

// Logged-out screens: step 1, what the app does, one action
function Welcome({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <Steps current={1} />
        <Link href="/setup" className="text-sm text-areia underline-offset-4 transition-colors hover:text-papel hover:underline">
          Ajuda
        </Link>
      </div>
      <div className="flex flex-col gap-5">
        <h1 className="wide text-5xl leading-[0.95] sm:text-7xl">Playlist Splitter</h1>
        <p className="max-w-[44ch] text-lg text-areia sm:text-xl">
          Separa as músicas das suas playlists por gênero e cria uma playlist para cada um. Você revisa tudo
          antes; nada muda no Spotify sem a sua confirmação.
        </p>
      </div>
      <div className="flex flex-col gap-2" aria-hidden>
        <div className="h-3 rounded-full bg-papel/90" />
        <div className="split-in flex h-14 gap-0.5 overflow-hidden rounded-lg sm:h-16">
          {SAMPLE.map(([genre, share], i) => (
            <div
              key={genre}
              className="flex min-w-0 items-end px-2 pb-1.5"
              style={{ flexGrow: share, flexBasis: 0, background: genreColor(genre) }}
            >
              {i < 4 && (
                <span className={`truncate text-xs font-bold text-cafe sm:text-sm ${i === 3 ? "hidden sm:inline" : ""}`}>
                  {genre}
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

function LoginButton({ label = "Entrar com Spotify" }: { label?: string }) {
  return (
    <form action={login}>
      <button className="rounded-full bg-papel px-7 py-3.5 text-lg font-bold text-cafe transition-opacity hover:opacity-90">
        {label}
      </button>
    </form>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const session = await auth();
  const { error } = await searchParams;

  if (!session?.accessToken) {
    const known = error ? matchAuthError(String(error)) : null;
    return (
      <Welcome>
        <LocalhostWarning />
        {error && (
          <ErrorBox>
            Falha no login (Auth.js): <strong>{String(error)}</strong>. Veja o terminal do
            servidor para detalhes.
            {known && (
              <span className="mt-1.5 block text-papel">
                <strong>Causa provável, {known.title}:</strong> {known.fix}{" "}
                <Link href={setupHref(known)} className="underline underline-offset-2">
                  Ver em Configuração
                </Link>
              </span>
            )}
          </ErrorBox>
        )}
        <LoginButton />
        <p className="text-xs text-areia">
          Redirect URI esperada:{" "}
          <code className="break-all">{`${process.env.AUTH_URL}/api/auth/callback/spotify`}</code>
        </p>
      </Welcome>
    );
  }

  if (session.error === "RefreshTokenError") {
    return (
      <Welcome>
        <ErrorBox>Não foi possível renovar o token do Spotify. Entre novamente.</ErrorBox>
        <LoginButton label="Entrar novamente" />
      </Welcome>
    );
  }

  // Spotify data is loaded on demand in the browser (queued, cached per tab)
  return (
    <SpotifyApp
      logout={
        <form action={logout}>
          <button className="rounded-full border border-fio px-3 py-1 text-sm text-areia transition-colors hover:border-areia hover:text-papel">
            Sair
          </button>
        </form>
      }
    />
  );
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="flex w-full flex-1 flex-col items-center justify-center">
      <Suspense fallback={<p className="text-areia">Carregando…</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
