import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, signIn, signOut } from "@/auth";

type SpotifyImage = { url: string };
type Me = {
  display_name: string | null;
  email?: string;
  images?: SpotifyImage[];
};
type Playlist = {
  id: string;
  name: string;
  images: SpotifyImage[] | null;
  owner: { display_name: string | null };
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function spotifyGet<T>(path: string, token: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message = body?.error?.message ?? res.statusText;
      return { ok: false, error: `GET ${path} → ${res.status} ${message}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: `GET ${path} → falha de rede: ${String(err)}` };
  }
}

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

  const [me, playlists] = await Promise.all([
    spotifyGet<Me>("/me", session.accessToken),
    spotifyGet<{ items: Playlist[] }>("/me/playlists?limit=5", session.accessToken),
  ]);

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex items-center gap-4">
        {me.ok ? (
          <>
            {me.data.images?.[0] && (
              <Image
                src={me.data.images[0].url}
                alt=""
                width={64}
                height={64}
                className="rounded-full"
              />
            )}
            <div>
              <p className="text-lg font-semibold">{me.data.display_name ?? "(sem nome)"}</p>
              <p className="text-sm text-gray-600">
                {me.data.email ?? "e-mail não retornado pela API"}
              </p>
            </div>
          </>
        ) : (
          <ErrorBox>{me.error}</ErrorBox>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Primeiras 5 playlists</h2>
        {!playlists.ok ? (
          <ErrorBox>{playlists.error}</ErrorBox>
        ) : playlists.data.items.length === 0 ? (
          <p className="text-sm text-gray-600">Nenhuma playlist encontrada.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {playlists.data.items.filter(Boolean).map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                {p.images?.[0] ? (
                  <Image src={p.images[0].url} alt="" width={40} height={40} />
                ) : (
                  <div className="h-10 w-10 bg-gray-200" />
                )}
                <div>
                  <p>{p.name}</p>
                  <p className="text-xs text-gray-500">{p.owner.display_name}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={logout}>
        <button className="rounded-full border px-6 py-2 hover:bg-gray-100">Sair</button>
      </form>
    </div>
  );
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold">Spotify Login Test</h1>
      <Suspense fallback={<p>Carregando…</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
