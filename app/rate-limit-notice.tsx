"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { RateLimitState } from "@/lib/request-queue";

type Queue = { subscribe: (l: () => void) => () => void; getRateLimit: () => RateLimitState };

export function RateLimitNotice({ queue, service }: { queue: Queue; service: string }) {
  const state = useSyncExternalStore(queue.subscribe, queue.getRateLimit, () => null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state]);

  if (!state) return null;
  const seconds = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  return (
    <p className="rounded-md border border-yellow-400 bg-yellow-50 p-2 text-sm text-yellow-900">
      {state.status === 429
        ? `${service} limitou as requisições, retomando em ${seconds}s`
        : `${service} instável (${state.status === null ? "falha de rede" : `erro ${state.status}`}), tentando de novo em ${seconds}s`}
    </p>
  );
}
