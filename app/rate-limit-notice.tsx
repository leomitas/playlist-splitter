"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { RateLimitState } from "@/lib/request-queue";

type Queue = { subscribe: (l: () => void) => () => void; getRateLimit: () => RateLimitState };

const pad = (n: number) => String(n).padStart(2, "0");

// 42 s · 3:05 · 2 h 03 min
function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  return `${Math.floor(seconds / 3600)} h ${pad(Math.floor((seconds % 3600) / 60))} min`;
}

export function RateLimitNotice({ queue, service }: { queue: Queue; service: string }) {
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
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-alerta/50 bg-alerta/10 p-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold text-alerta">
          {limited
            ? `${service} pediu uma pausa`
            : `${service} instável (${state.status === null ? "falha de rede" : `erro ${state.status}`})`}
        </p>
        <p className="num flex-none text-3xl text-alerta" aria-label={`retomando em ${formatWait(seconds)}`}>
          {formatWait(seconds)}
        </p>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-cafe" aria-hidden>
        <div className="h-full bg-alerta" style={{ width: `${(left / wait.total) * 100}%` }} />
      </div>
      <p className="text-xs text-areia">
        {limited ? "Retomando sozinho quando o tempo acabar. Nada é perdido." : "Tentando de novo quando o tempo acabar."}
      </p>
    </div>
  );
}
