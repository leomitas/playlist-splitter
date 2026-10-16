import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, signIn, signOut } from "@/auth";
import { SpotifyApp } from "./spotify-app";

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
    <div className="rounded-md border border-erro/60 bg-erro/10 p-3 text-sm text-erro break-words">
      {children}
    </div>
  );
}

function LoginButton({ label = "Entrar com Spotify" }: { label?: string }) {
  return (
    <form action={login}>
      <button className="rounded-full bg-papel px-6 py-3 font-bold text-cafe transition-opacity hover:opacity-90">
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
    return (
      <div className="flex flex-col items-center gap-4">
        <h1 className="wide text-3xl">Playlist Splitter</h1>
        {error && (
          <ErrorBox>
            Falha no login (Auth.js): <strong>{String(error)}</strong>. Veja o terminal do
            servidor para detalhes.
          </ErrorBox>
        )}
        <LoginButton />
        <p className="text-xs text-areia">
          Redirect URI esperada:{" "}
          <code>{`${process.env.AUTH_URL}/api/auth/callback/spotify`}</code>
        </p>
      </div>
    );
  }

  if (session.error === "RefreshTokenError") {
    return (
      <div className="flex flex-col items-center gap-4">
        <h1 className="wide text-3xl">Playlist Splitter</h1>
        <ErrorBox>Não foi possível renovar o token do Spotify. Entre novamente.</ErrorBox>
        <LoginButton label="Entrar novamente" />
      </div>
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
