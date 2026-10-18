"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { blockedReason, formatBlockEnd, formatBlockLeft } from "@/lib/quota-block";
import { spotifyBlock } from "@/lib/spotify-client";

// End of the current Spotify block (ms) or null; survives reloads (localStorage)
export function useSpotifyBlock() {
  const until = useSyncExternalStore(spotifyBlock.subscribe, spotifyBlock.get, () => null);
  return { until, reason: until ? blockedReason(until) : undefined };
}

// Fixed strip while Spotify blocks the app, with a countdown; nothing retries meanwhile
export function QuotaBanner({ until }: { until: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [until]);

  if (!until) return null;
  return (
    <div role="alert" className="border-b border-alerta/50 bg-alerta/15 text-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
        <p className="font-bold text-alerta">
          Spotify bloqueou o app até {formatBlockEnd(until, now)} (faltam {formatBlockLeft(until - now)})
        </p>
        <p className="text-areia">
          Cota de requisições esgotada. Botões que chamam o Spotify voltam sozinhos quando o tempo acabar; tentar
          antes só prolonga o bloqueio.{" "}
          <Link href="/setup#erro-quota" className="text-papel underline underline-offset-2">
            Entenda
          </Link>
        </p>
      </div>
    </div>
  );
}
