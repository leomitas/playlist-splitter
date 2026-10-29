"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import type { Check } from "@/lib/config-test";
import { LOCAL_URL } from "@/lib/env-check";
import { useI18n, type I18n } from "../i18n";
import { testConfiguration } from "./actions";

export type StepStatus = "pendente" | "ok" | "atenção";

const CHIP: Record<StepStatus, string> = {
  pendente: "border-fio text-areia",
  ok: "border-ok/50 text-ok",
  atenção: "border-alerta/60 text-alerta",
};

export function StatusChip({ status }: { status: StepStatus }) {
  const { t } = useI18n();
  return (
    <span className={`flex-none rounded-full border px-2.5 py-0.5 text-xs font-bold ${CHIP[status]}`}>
      {t(`setup.status.${status}`)}
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      className="flex-none rounded-full border border-fio px-3 py-1 text-xs transition-colors hover:border-areia hover:bg-grafite-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // clipboard blocked: the value stays visible to copy by hand
        }
      }}
    >
      {copied ? t("setup.copied") : (label ?? t("setup.copy"))}
    </button>
  );
}

// One labelled value with a copy button
export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-areia">{label}</span>
      <div className="flex items-center gap-2 rounded-md border border-fio bg-cafe px-3 py-2">
        <code className="min-w-0 flex-1 text-sm break-all">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

const noopSubscribe = () => () => {};

// The page must be opened on 127.0.0.1: Spotify rejects localhost as redirect URI
export function LocalhostWarning() {
  const { t, rich } = useI18n();
  const host = useSyncExternalStore(noopSubscribe, () => window.location.hostname, () => "");
  if (host !== "localhost") return null;
  const url = `http://127.0.0.1:${window.location.port || "3000"}${window.location.pathname}`;
  return (
    <div role="alert" className="rounded-lg border border-alerta/60 bg-alerta/10 p-3 text-sm">
      <p className="font-bold text-alerta">{t("setup.localhost.title")}</p>
      <p className="text-areia">
        {rich(
          "setup.localhost.body",
          { url },
          {
            link: (c) => (
              <a className="text-papel underline underline-offset-2" href={url}>
                {c}
              </a>
            ),
          },
        )}
      </p>
    </div>
  );
}

const DONE_PREFIX = "setup-done:";

function readDone(id: string) {
  try {
    return localStorage.getItem(DONE_PREFIX + id) === "1";
  } catch {
    return false;
  }
}

const doneListeners = new Set<() => void>();
const subscribeDone = (l: () => void) => {
  doneListeners.add(l);
  return () => doneListeners.delete(l);
};

// Steps the app can't verify by itself: the user marks them done (kept in this browser)
export function ManualStep({ id, warn }: { id: string; warn?: boolean }) {
  const { t } = useI18n();
  const done = useSyncExternalStore(subscribeDone, () => readDone(id), () => false);
  const host = useSyncExternalStore(noopSubscribe, () => window.location.hostname, () => "");
  const status: StepStatus = done ? "ok" : warn && host === "localhost" ? "atenção" : "pendente";
  return (
    <div className="flex items-center gap-3">
      <StatusChip status={status} />
      <label className="flex cursor-pointer items-center gap-2 text-xs text-areia">
        <input
          type="checkbox"
          className="check"
          checked={done}
          onChange={(e) => {
            try {
              if (e.target.checked) localStorage.setItem(DONE_PREFIX + id, "1");
              else localStorage.removeItem(DONE_PREFIX + id);
            } catch {
              // storage blocked: the mark just won't stick
            }
            doneListeners.forEach((l) => l());
          }}
        />
        {t("setup.manualDone")}
      </label>
    </div>
  );
}

// 32 random bytes, base64url; generated and shown only in this browser
function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function SecretGenerator() {
  const { t } = useI18n();
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-full bg-papel px-4 py-1.5 text-sm font-bold text-cafe transition-opacity hover:opacity-90"
          onClick={() => setSecret(randomSecret())}
        >
          {t("setup.secret.generate")}
        </button>
        <span className="text-xs text-areia">{t("setup.secret.local")}</span>
      </div>
      {secret && <CopyField label={t("setup.secret.paste")} value={secret} />}
    </div>
  );
}

// label and hint of one check, from its id and hint code
function checkText({ t }: I18n, c: Check) {
  const label =
    c.id === "auth-url" || c.id === "auth-secret" || c.id === "spotify" || c.id === "lastfm"
      ? t(`setup.check.${c.id}`, { url: LOCAL_URL })
      : t("setup.check.env", { name: c.id });
  const hint = c.hint && t(`setup.hint.${c.hint}`, { url: LOCAL_URL, status: String(c.status ?? "") });
  return { label, hint };
}

export function ConfigTester() {
  const i18n = useI18n();
  const { t } = i18n;
  const [result, setResult] = useState<Check[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-full bg-papel px-5 py-2 font-bold text-cafe transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                const r = await testConfiguration();
                setFailed(false);
                if (!r.available) setUnavailable(true);
                else setResult(r.checks);
              } catch {
                setFailed(true);
              }
            })
          }
        >
          {pending ? t("setup.tester.testing") : t("setup.tester.test")}
        </button>
        <span className="text-xs text-areia">{t("setup.tester.hint")}</span>
      </div>
      {unavailable && <p className="text-sm text-areia">{t("setup.tester.unavailable")}</p>}
      {failed && <p className="text-sm text-erro">{t("setup.tester.failed")}</p>}
      {result && (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-fio bg-cafe p-3 text-sm" aria-live="polite">
          {result.map((c) => {
            const { label, hint } = checkText(i18n, c);
            return (
              <li key={c.id} className="flex flex-col">
                <span className={c.ok ? "text-ok" : "text-erro"}>
                  {c.ok ? "✓" : "✗"} {t(c.ok ? "setup.tester.ok" : "setup.tester.fail", { label })}
                </span>
                {hint && <span className="pl-4 text-xs text-areia">{hint}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
