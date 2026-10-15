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
    <div className="rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-800 break-words">
      {children}
    </div>
  );
}

function LoginButton({ label = "Entrar com Spotify" }: { label?: string }) {
  return (
    <form action={login}>
      <button className="rounded-full bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700">
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
        {error && (
          <ErrorBox>
            Falha no login (Auth.js): <strong>{String(error)}</strong>. Veja o terminal do
            servidor para detalhes.
          </ErrorBox>
        )}
        <LoginButton />
        <p className="text-xs text-gray-500">
          Redirect URI esperada:{" "}
          <code>{`${process.env.AUTH_URL}/api/auth/callback/spotify`}</code>
        </p>
      </div>
    );
  }

  if (session.error === "RefreshTokenError") {
    return (
      <div className="flex flex-col items-center gap-4">
        <ErrorBox>Não foi possível renovar o token do Spotify. Entre novamente.</ErrorBox>
        <LoginButton label="Entrar novamente" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Spotify data is loaded on demand in the browser (queued, cached per tab) */}
      <SpotifyApp />
      <form action={logout}>
        <button className="rounded-full border px-6 py-2 hover:bg-gray-100">Sair</button>
      </form>
    </div>
  );
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold">Spotify Login Test</h1>
      <Suspense fallback={<p>Carregando…</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
