// Setup guide. Works without login and without any environment variable: it never imports
// auth.ts and only reads whether each variable is present.

import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { envPresence, LOCAL_URL, missingEnv, REDIRECT_URI, REQUIRED_ENV, type EnvName } from "@/lib/env-check";
import { KNOWN_ERRORS } from "@/lib/known-errors";
import {
  ConfigTester,
  CopyButton,
  CopyField,
  LocalhostWarning,
  ManualStep,
  SecretGenerator,
  StatusChip,
  type StepStatus,
} from "./setup-client";
import { Preferences } from "../preferences";
import { VIDEOS } from "./videos";

export const metadata: Metadata = { title: "Configuração · Playlist Splitter" };

const ENV_DOCS: Record<EnvName, { what: string; where: string }> = {
  AUTH_SPOTIFY_ID: {
    what: "Identifica o seu app no Spotify (o Client ID).",
    where: "Spotify Dashboard > seu app > Settings > Client ID.",
  },
  AUTH_SPOTIFY_SECRET: {
    what: "Senha do app, usada pelo servidor para trocar o login por um token. Nunca compartilhe nem commite.",
    where: "Spotify Dashboard > seu app > Settings > View client secret.",
  },
  AUTH_SECRET: {
    what: "Chave aleatória que criptografa o cookie de sessão. Qualquer texto aleatório de 32+ caracteres.",
    where: "Use o botão \"Gerar AUTH_SECRET\" abaixo ou rode npm run setup:env.",
  },
  AUTH_URL: {
    what: "Endereço do app, usado para montar a redirect URI enviada ao Spotify.",
    where: `Sempre ${LOCAL_URL} (127.0.0.1, porta 3000).`,
  },
  LASTFM_API_KEY: {
    what: "Chave de leitura do Last.fm, de onde vêm os gêneros (tags) de artistas e faixas.",
    where: "Last.fm > API account: o campo \"API key\" (não o \"Shared secret\").",
  },
};

const ENV_TEMPLATE = `# Spotify Dashboard > seu app > Settings
AUTH_SPOTIFY_ID=
AUTH_SPOTIFY_SECRET=
# Gere em /setup ou com npm run setup:env
AUTH_SECRET=
# Sempre 127.0.0.1, nunca localhost
AUTH_URL=${LOCAL_URL}
# Last.fm > API account > API key
LASTFM_API_KEY=
`;

function Step({
  n,
  id,
  title,
  status,
  children,
}: {
  n: string;
  id: string;
  title: string;
  status: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-4 rounded-xl border border-fio bg-grafite p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="flex items-center gap-3 text-lg font-bold">
          <span className="grid size-7 flex-none place-items-center rounded-full border border-papel text-sm">{n}</span>
          {title}
        </h2>
        {status}
      </div>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-papel/90">{children}</div>
    </section>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="font-bold text-papel underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function VideoSlot({ video }: { video: (typeof VIDEOS)[keyof typeof VIDEOS] }) {
  if (video.src) {
    return <video className="aspect-video w-full rounded-lg border border-fio bg-cafe" src={video.src} controls preload="none" title={video.title} />;
  }
  return (
    <div className="grid aspect-video w-full max-w-md place-items-center rounded-lg border border-dashed border-fio bg-cafe text-center text-xs text-areia">
      <span>
        Vídeo curto em breve
        <br />
        <span className="text-papel">{video.title}</span>
      </span>
    </div>
  );
}

const fieldList = "flex flex-col gap-2";

async function Guide() {
  await connection();
  const present = envPresence();
  const missing = REQUIRED_ENV.filter((n) => !present[n]);
  const envStatus: StepStatus = missing.length === 0 ? "ok" : missing.length < REQUIRED_ENV.length ? "atenção" : "pendente";
  const devServer = process.env.NODE_ENV !== "production";

  return (
    <>
      {missing.length > 0 && (
        <div role="alert" className="rounded-lg border border-erro/50 bg-erro/10 p-3 text-sm">
          <p className="font-bold text-erro">Configuração incompleta: o app abre depois de preencher o .env.local.</p>
          <p className="text-areia">
            Falta: <code className="text-papel">{missing.join(", ")}</code>. Já preencheu? Reinicie o servidor (passo 6).
          </p>
        </div>
      )}

      <Step n="1" id="premium" title="Spotify Premium" status={<ManualStep id="premium" />}>
        <p>
          Apps em Development Mode só funcionam se a conta <strong>dona do app</strong> (a que cria o app no passo 2) tiver
          Spotify Premium ativo. Quem só usa o app pode ter conta grátis, mas precisa estar cadastrado (passo 3).
        </p>
      </Step>

      <Step n="2" id="dashboard" title="Criar o app no Spotify Dashboard" status={<ManualStep id="dashboard" warn />}>
        <p>
          Abra o <ExternalLink href="https://developer.spotify.com/dashboard">Spotify Developer Dashboard</ExternalLink>, entre
          com a conta Premium e clique em <strong>Create app</strong>. Preencha:
        </p>
        <div className={fieldList}>
          <CopyField label="App name" value="Playlist Splitter (local)" />
          <CopyField label="App description" value="Separa minhas playlists por gênero. Uso pessoal, rodando no meu computador." />
          <CopyField label="Redirect URIs (clique em Add depois de colar)" value={REDIRECT_URI} />
        </div>
        <p>
          Em <strong>Which API/SDKs are you planning to use?</strong> marque <strong>somente Web API</strong>. Aceite os termos e
          salve. Depois, em <strong>Settings</strong>, copie o Client ID e o Client Secret para o passo 5.
        </p>
        <LocalhostWarning />
        <VideoSlot video={VIDEOS.spotify} />
      </Step>

      <Step n="3" id="users" title="Cadastrar seu e-mail em User Management" status={<ManualStep id="users" />}>
        <p>
          No Dashboard, abra seu app &gt; <strong>User Management</strong> e adicione o nome e o e-mail da conta Spotify que vai
          usar o app (inclusive a sua). Sem isso, o login funciona mas toda chamada dá <strong>403</strong>. O limite em
          Development Mode é de <strong>5 usuários</strong>.
        </p>
      </Step>

      <Step
        n="4"
        id="lastfm"
        title="Chave do Last.fm"
        status={present.LASTFM_API_KEY ? <StatusChip status="ok" /> : <ManualStep id="lastfm" />}
      >
        <p>
          Os gêneros vêm das tags do Last.fm. Crie uma conta e abra{" "}
          <ExternalLink href="https://www.last.fm/api/account/create">Create API account</ExternalLink>:
        </p>
        <div className={fieldList}>
          <CopyField label="Application name" value="Playlist Splitter (local)" />
          <CopyField label="Application description" value="Lê tags de artistas e faixas para classificar minhas playlists por gênero." />
        </div>
        <p className="text-areia">
          Contact email: o seu. Callback URL e Application homepage podem ficar em branco. Ao enviar, copie a{" "}
          <strong className="text-papel">API key</strong> (o Shared secret não é usado).
        </p>
        <VideoSlot video={VIDEOS.lastfm} />
      </Step>

      <Step n="5" id="env" title="Montar o .env.local" status={<StatusChip status={envStatus} />}>
        <p>
          Na pasta do projeto, rode <code>npm run setup:env</code> (copia o .env.example para .env.local sem sobrescrever e já gera o
          AUTH_SECRET) ou crie o arquivo com o modelo abaixo. Depois preencha:
        </p>
        <dl className="flex flex-col gap-3">
          {REQUIRED_ENV.map((name) => (
            <div key={name} className="flex flex-col gap-0.5 rounded-lg border border-fio bg-cafe/50 p-3">
              <dt className="flex items-center justify-between gap-2">
                <code className="font-bold">{name}</code>
                <span className={`text-xs ${present[name] ? "text-ok" : "text-areia"}`}>
                  {present[name] ? "✓ definida" : "não definida"}
                </span>
              </dt>
              <dd className="text-areia">{ENV_DOCS[name].what}</dd>
              <dd className="text-xs text-areia">
                <span className="text-papel">Onde achar:</span> {ENV_DOCS[name].where}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-areia">Modelo do .env.local</span>
            <CopyButton value={ENV_TEMPLATE} label="Copiar modelo" />
          </div>
          <pre className="overflow-x-auto rounded-md border border-fio bg-cafe p-3 text-xs">{ENV_TEMPLATE}</pre>
        </div>
        <SecretGenerator />
        <p className="text-xs text-areia">O .env.local já está no .gitignore. Nunca o commite nem cole os valores em issues.</p>
        <VideoSlot video={VIDEOS.env} />
      </Step>

      <Step
        n="6"
        id="restart"
        title="Reiniciar o servidor"
        status={<StatusChip status={missing.length === 0 ? "ok" : "atenção"} />}
      >
        <p>
          O Next.js lê o .env.local <strong>só ao iniciar</strong>. Pare o servidor (Ctrl+C) e rode <code>npm run dev</code> de novo
          sempre que mudar o .env.local. Mudanças no Spotify Dashboard (redirect URI, User Management) não pedem reinício, só
          sair e entrar de novo.
        </p>
        <p className="text-areia">
          No Windows, parar o servidor às vezes deixa um processo preso na porta 3000 com as variáveis antigas. Rode{" "}
          <code>npm run doctor</code> para conferir a configuração.
        </p>
        {devServer && <ConfigTester />}
      </Step>
    </>
  );
}

// The app is reachable only when no required variable is missing; until then the proxy sends
// "/" back here, so no link to "/" is rendered (it would loop)
async function appReady() {
  await connection();
  return missingEnv().length === 0;
}

const LOCKED = "Complete os passos para liberar o app";

function TopNav({ ready }: { ready: boolean }) {
  return (
    <nav aria-label="Navegação" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {ready ? (
        <Link href="/" className="wide text-lg sm:text-xl">
          Playlist Splitter
        </Link>
      ) : (
        <span className="wide text-lg sm:text-xl">Playlist Splitter</span>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <Preferences />
        {ready ? (
        <Link href="/" className="text-sm text-areia underline-offset-4 transition-colors hover:text-papel hover:underline">
          <span aria-hidden>← </span>Voltar ao app
        </Link>
      ) : (
        <span className="text-sm text-areia/60" aria-disabled="true" title={LOCKED}>
          <span aria-hidden>← </span>Voltar ao app <span className="sr-only">(indisponível: {LOCKED.toLowerCase()})</span>
        </span>
      )}
      </div>
    </nav>
  );
}

async function ReadyTopNav() {
  return <TopNav ready={await appReady()} />;
}

function GoToApp({ ready }: { ready: boolean }) {
  const base = "inline-flex w-full items-center justify-center rounded-full px-6 py-3 font-bold sm:w-auto";
  return ready ? (
    <Link href="/" className={`${base} bg-papel text-cafe transition-opacity hover:opacity-90`}>
      Ir para o app
    </Link>
  ) : (
    <button type="button" disabled className={`${base} cursor-not-allowed bg-papel text-cafe opacity-40`}>
      {LOCKED}
    </button>
  );
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
        <h1 className="wide text-3xl sm:text-4xl">Configuração</h1>
        <p className="max-w-[60ch] text-areia">
          O app roda no seu computador com o seu próprio app do Spotify. São seis passos, uma vez só. Abra sempre{" "}
          <code className="text-papel">{LOCAL_URL}</code>.
        </p>
      </header>

      <Suspense fallback={<p className="text-areia">Conferindo a configuração…</p>}>
        <Guide />
      </Suspense>

      <section id="erros" aria-labelledby="erros-title" className="flex scroll-mt-6 flex-col gap-3">
        <h2 id="erros-title" className="text-lg font-bold">
          Erros comuns
        </h2>
        <ul className="flex flex-col gap-2">
          {KNOWN_ERRORS.map((e) => (
            <li key={e.id} id={`erro-${e.id}`} className="scroll-mt-6 rounded-xl border border-fio bg-grafite p-4 text-sm">
              <p className="font-bold">{e.title}</p>
              <p className="text-areia">{e.symptom}</p>
              <p className="mt-1">
                <span className="font-bold text-ok">Solução:</span> {e.fix}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-2 border-t border-fio pt-6">
        <Suspense fallback={<GoToApp ready={false} />}>
          <ReadyGoToApp />
        </Suspense>
      </div>
    </main>
  );
}
