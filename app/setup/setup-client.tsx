"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import type { Check } from "@/lib/config-test";
import { testConfiguration } from "./actions";

export type StepStatus = "pendente" | "ok" | "atenção";

const CHIP: Record<StepStatus, string> = {
  pendente: "border-fio text-areia",
  ok: "border-ok/50 text-ok",
  atenção: "border-alerta/60 text-alerta",
};

export function StatusChip({ status }: { status: StepStatus }) {
  return (
    <span className={`flex-none rounded-full border px-2.5 py-0.5 text-xs font-bold ${CHIP[status]}`}>
      {status === "ok" ? "✓ ok" : status}
    </span>
  );
}

export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
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
      {copied ? "Copiado" : label}
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
  const host = useSyncExternalStore(noopSubscribe, () => window.location.hostname, () => "");
  if (host !== "localhost") return null;
  const url = `http://127.0.0.1:${window.location.port || "3000"}${window.location.pathname}`;
  return (
    <div role="alert" className="rounded-lg border border-alerta/60 bg-alerta/10 p-3 text-sm">
      <p className="font-bold text-alerta">Esta página foi aberta por localhost.</p>
      <p className="text-areia">
        O Spotify não aceita localhost como redirect URI e o login não funciona por aqui. Abra{" "}
        <a className="text-papel underline underline-offset-2" href={url}>
          {url}
        </a>
        .
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
        Feito
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
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-full bg-papel px-4 py-1.5 text-sm font-bold text-cafe transition-opacity hover:opacity-90"
          onClick={() => setSecret(randomSecret())}
        >
          Gerar AUTH_SECRET
        </button>
        <span className="text-xs text-areia">Gerado no seu navegador; não é enviado a lugar nenhum.</span>
      </div>
      {secret && <CopyField label="Cole em AUTH_SECRET no .env.local" value={secret} />}
    </div>
  );
}

export function ConfigTester() {
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
          {pending ? "Testando…" : "Testar configuração"}
        </button>
        <span className="text-xs text-areia">
          Confere se cada variável existe e se o Spotify e o Last.fm aceitam as chaves. Nenhum valor é mostrado.
        </span>
      </div>
      {unavailable && <p className="text-sm text-areia">Disponível só no servidor de desenvolvimento (npm run dev).</p>}
      {failed && <p className="text-sm text-erro">Não foi possível falar com o servidor. Ele está rodando?</p>}
      {result && (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-fio bg-cafe p-3 text-sm" aria-live="polite">
          {result.map((c) => (
            <li key={c.id} className="flex flex-col">
              <span className={c.ok ? "text-ok" : "text-erro"}>
                {c.ok ? "✓" : "✗"} {c.label}: {c.ok ? "ok" : "falhou"}
              </span>
              {c.hint && <span className="pl-4 text-xs text-areia">{c.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
