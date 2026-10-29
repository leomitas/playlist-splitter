import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, signIn, signOut } from "@/auth";
import { matchAuthError } from "@/lib/known-errors";
import { SpotifyApp } from "./spotify-app";
import { LoadingText, LoginScreen, LogoutButton, RefreshFailedScreen } from "./welcome";

async function login() {
  "use server";
  const url: string = await signIn("spotify", { redirect: false, redirectTo: "/" });
  console.log("[auth] redirect_uri sent to Spotify:", new URL(url).searchParams.get("redirect_uri"));
  redirect(url);
}

async function logout() {
  "use server";
  await signOut({ redirectTo: "/" });
}

async function Content({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const session = await auth();
  const { error } = await searchParams;

  if (!session?.accessToken) {
    const code = error ? String(error) : undefined;
    return (
      <LoginScreen
        login={login}
        error={code}
        known={code ? (matchAuthError(code)?.id ?? null) : null}
        redirectUri={`${process.env.AUTH_URL}/api/auth/callback/spotify`}
      />
    );
  }

  if (session.error === "RefreshTokenError") return <RefreshFailedScreen login={login} />;

  // Spotify data is loaded on demand in the browser (queued, cached per tab)
  return <SpotifyApp logout={<LogoutButton action={logout} />} />;
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="flex w-full flex-1 flex-col items-center justify-center">
      <Suspense fallback={<LoadingText />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
