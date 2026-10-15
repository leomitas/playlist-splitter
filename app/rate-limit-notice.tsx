"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { spotify } from "@/lib/spotify-client";

export function RateLimitNotice() {
  const state = useSyncExternalStore(spotify.subscribe, spotify.getRateLimit, () => null);
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
      Spotify limitou as requisições, tentando de novo em {seconds}s
    </p>
  );
}
