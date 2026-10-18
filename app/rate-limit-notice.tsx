"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { RateLimitState } from "@/lib/request-queue";
import { useI18n, type I18n } from "./i18n";

type Queue = { subscribe: (l: () => void) => () => void; getRateLimit: () => RateLimitState };

const pad = (n: number) => String(n).padStart(2, "0");

// 42 s · 3:05 · 2 h 03 min
function formatWait({ t }: I18n, seconds: number) {
  if (seconds < 60) return t("wait.seconds", { s: seconds });
  if (seconds < 3600) return t("wait.minutes", { m: Math.floor(seconds / 60), s: pad(seconds % 60) });
  return t("wait.hours", { h: Math.floor(seconds / 3600), m: pad(Math.floor((seconds % 3600) / 60)) });
}

export function RateLimitNotice({ queue, service }: { queue: Queue; service: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const state = useSyncExternalStore(queue.subscribe, queue.getRateLimit, () => null);
  const [now, setNow] = useState(() => Date.now());
  // length of the current wait, for the draining bar; reset whenever a new wait starts
  const [wait, setWait] = useState({ retryAt: 0, total: 1 });
  if (state && state.retryAt !== wait.retryAt) setWait({ retryAt: state.retryAt, total: Math.max(1, state.retryAt - now) });

  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state]);

  if (!state) return null;
  const left = Math.max(0, state.retryAt - now);
  const seconds = Math.ceil(left / 1000);
  const limited = state.status === 429;
  const time = formatWait(i18n, seconds);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-alerta/50 bg-alerta/10 p-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold text-alerta">
          {limited
            ? t("rate.paused", { service })
            : t("rate.unstable", {
                service,
                detail: state.status === null ? t("rate.network") : t("rate.status", { status: String(state.status) }),
              })}
        </p>
        <p className="num flex-none text-3xl text-alerta" aria-label={t("rate.resumingIn", { time })}>
          {time}
        </p>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-cafe" aria-hidden>
        <div className="h-full bg-alerta" style={{ width: `${(left / wait.total) * 100}%` }} />
      </div>
      <p className="text-xs text-areia">{limited ? t("rate.resumeAuto") : t("rate.retryAuto")}</p>
    </div>
  );
}
