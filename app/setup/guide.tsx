"use client";

// The text of /setup. The page (server) only reads which variables exist and whether the app
// is ready; everything shown goes through the dictionaries so it follows the chosen language.

import { useEffect } from "react";
import Link from "next/link";
import { LOCAL_URL, REDIRECT_URI, REQUIRED_ENV, type EnvName } from "@/lib/env-check";
import { KNOWN_ERRORS } from "@/lib/known-errors";
import { useI18n, useRevealText } from "../i18n";
import { Preferences } from "../preferences";
import { ConfigTester, CopyButton, CopyField, LocalhostWarning, ManualStep, SecretGenerator, StatusChip, type StepStatus } from "./setup-client";
import { VIDEOS } from "./videos";

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
  const { t } = useI18n();
  if (video.src) {
    return <video className="aspect-video w-full rounded-lg border border-fio bg-cafe" src={video.src} controls preload="none" title={t(video.title)} />;
  }
  return (
    <div className="grid aspect-video w-full max-w-md place-items-center rounded-lg border border-dashed border-fio bg-cafe text-center text-xs text-areia">
      <span>
        {t("setup.video.soon")}
        <br />
        <span className="text-papel">{t(video.title)}</span>
      </span>
    </div>
  );
}

const fieldList = "flex flex-col gap-2";

// The six steps; present: which required variables are set (never their values)
export function SetupGuide({ present, devServer }: { present: Record<EnvName, boolean>; devServer: boolean }) {
  const { t, rich } = useI18n();
  useRevealText();
  const missing = REQUIRED_ENV.filter((n) => !present[n]);
  const envStatus: StepStatus = missing.length === 0 ? "ok" : missing.length < REQUIRED_ENV.length ? "atenção" : "pendente";
  const strong = { b: (c: string) => <strong className="text-papel">{c}</strong> };

  return (
    <>
      {missing.length > 0 && (
        <div role="alert" className="rounded-lg border border-erro/50 bg-erro/10 p-3 text-sm">
          <p className="font-bold text-erro">{t("setup.incomplete")}</p>
          <p className="text-areia">
            {rich("setup.missing", { names: missing.join(", ") }, { code: (c) => <code className="text-papel">{c}</code> })}
          </p>
        </div>
      )}

      <Step n="1" id="premium" title={t("setup.premium.title")} status={<ManualStep id="premium" />}>
        <p>{rich("setup.premium.body")}</p>
      </Step>

      <Step n="2" id="dashboard" title={t("setup.dashboard.title")} status={<ManualStep id="dashboard" warn />}>
        <p>
          {rich("setup.dashboard.open", undefined, {
            link: (c) => <ExternalLink href="https://developer.spotify.com/dashboard">{c}</ExternalLink>,
          })}
        </p>
        <div className={fieldList}>
          <CopyField label={t("setup.dashboard.appName")} value="Playlist Splitter (local)" />
          <CopyField label={t("setup.dashboard.appDescription")} value={t("setup.dashboard.appDescriptionValue")} />
          <CopyField label={t("setup.dashboard.redirect")} value={REDIRECT_URI} />
        </div>
        <p>{rich("setup.dashboard.webApi")}</p>
        <LocalhostWarning />
        <VideoSlot video={VIDEOS.spotify} />
      </Step>

      <Step n="3" id="users" title={t("setup.users.title")} status={<ManualStep id="users" />}>
        <p>{rich("setup.users.body")}</p>
      </Step>

      <Step
        n="4"
        id="lastfm"
        title={t("setup.lastfm.title")}
        status={present.LASTFM_API_KEY ? <StatusChip status="ok" /> : <ManualStep id="lastfm" />}
      >
        <p>
          {rich("setup.lastfm.open", undefined, {
            link: (c) => <ExternalLink href="https://www.last.fm/api/account/create">{c}</ExternalLink>,
          })}
        </p>
        <div className={fieldList}>
          <CopyField label={t("setup.lastfm.appName")} value="Playlist Splitter (local)" />
          <CopyField label={t("setup.lastfm.appDescription")} value={t("setup.lastfm.appDescriptionValue")} />
        </div>
        <p className="text-areia">{rich("setup.lastfm.after", undefined, strong)}</p>
        <VideoSlot video={VIDEOS.lastfm} />
      </Step>

      <Step n="5" id="env" title={t("setup.env.title")} status={<StatusChip status={envStatus} />}>
        <p>{rich("setup.env.intro")}</p>
        <dl className="flex flex-col gap-3">
          {REQUIRED_ENV.map((name) => (
            <div key={name} className="flex flex-col gap-0.5 rounded-lg border border-fio bg-cafe/50 p-3">
              <dt className="flex items-center justify-between gap-2">
                <code className="font-bold">{name}</code>
                <span className={`text-xs ${present[name] ? "text-ok" : "text-areia"}`}>
                  {present[name] ? t("setup.env.defined") : t("setup.env.notDefined")}
                </span>
              </dt>
              <dd className="text-areia">{t(`setup.env.${name}.what`)}</dd>
              <dd className="text-xs text-areia">
                <span className="text-papel">{t("setup.env.where")}</span> {t(`setup.env.${name}.where`, { url: LOCAL_URL })}
              </dd>
            </div>
          ))}
        </dl>
        <EnvTemplate />
        <SecretGenerator />
        <p className="text-xs text-areia">{t("setup.env.gitignore")}</p>
        <VideoSlot video={VIDEOS.env} />
      </Step>

      <Step
        n="6"
        id="restart"
        title={t("setup.restart.title")}
        status={<StatusChip status={missing.length === 0 ? "ok" : "atenção"} />}
      >
        <p>{rich("setup.restart.body")}</p>
        <p className="text-areia">{rich("setup.restart.windows")}</p>
        {devServer && <ConfigTester />}
      </Step>
    </>
  );
}

function EnvTemplate() {
  const { t } = useI18n();
  const template = t("setup.env.template", { url: LOCAL_URL });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-areia">{t("setup.env.templateLabel")}</span>
        <CopyButton value={template} label={t("setup.env.copyTemplate")} />
      </div>
      <pre className="overflow-x-auto rounded-md border border-fio bg-cafe p-3 text-xs">{template}</pre>
    </div>
  );
}

// Until the check streams in, nothing links to "/" (the proxy would send it back here)
export function TopNav({ ready }: { ready: boolean }) {
  const { t } = useI18n();
  const locked = t("setup.locked");
  return (
    <nav aria-label={t("setup.nav")} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
            <span aria-hidden>← </span>
            {t("setup.back")}
          </Link>
        ) : (
          <span className="text-sm text-areia/60" aria-disabled="true" title={locked}>
            <span aria-hidden>← </span>
            {t("setup.back")} <span className="sr-only">{t("setup.unavailable", { reason: locked.toLowerCase() })}</span>
          </span>
        )}
      </div>
    </nav>
  );
}

export function GoToApp({ ready }: { ready: boolean }) {
  const { t } = useI18n();
  const base = "inline-flex w-full items-center justify-center rounded-full px-6 py-3 font-bold sm:w-auto";
  return ready ? (
    <Link href="/" className={`${base} bg-papel text-cafe transition-opacity hover:opacity-90`}>
      {t("setup.goToApp")}
    </Link>
  ) : (
    <button type="button" disabled className={`${base} cursor-not-allowed bg-papel text-cafe opacity-40`}>
      {t("setup.locked")}
    </button>
  );
}

// Title, intro and the browser tab's title (metadata is rendered once, in the default language)
export function SetupHeader() {
  const { t, rich } = useI18n();
  useEffect(() => {
    document.title = t("setup.docTitle");
  }, [t]);
  return (
    <>
      <h1 className="wide text-3xl sm:text-4xl">{t("setup.title")}</h1>
      <p className="max-w-[60ch] text-areia">
        {rich("setup.intro", { url: LOCAL_URL }, { code: (c) => <code className="text-papel">{c}</code> })}
      </p>
    </>
  );
}

export function CheckingText() {
  const { t } = useI18n();
  return <p className="text-areia">{t("setup.checking")}</p>;
}

export function CommonErrors() {
  const { t } = useI18n();
  return (
    <section id="erros" aria-labelledby="erros-title" className="flex scroll-mt-6 flex-col gap-3">
      <h2 id="erros-title" className="text-lg font-bold">
        {t("setup.errors.title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {KNOWN_ERRORS.map((e) => (
          <li key={e.id} id={`erro-${e.id}`} className="scroll-mt-6 rounded-xl border border-fio bg-grafite p-4 text-sm">
            <p className="font-bold">{t(`knownError.${e.id}.title`)}</p>
            <p className="text-areia">{t(`knownError.${e.id}.symptom`)}</p>
            <p className="mt-1">
              <span className="font-bold text-ok">{t("setup.errors.fix")}</span> {t(`knownError.${e.id}.fix`)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
