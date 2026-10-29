"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { blockLeft, formatBlockEnd } from "@/lib/quota-block";
import { spotifyBlock } from "@/lib/spotify-client";
import { useI18n, type I18n } from "./i18n";

const pad = (n: number) => String(n).padStart(2, "0");

// "2h 05m", "12m", "menos de 1m"
function formatLeft({ t }: I18n, ms: number) {
  const left = blockLeft(ms);
  if (!left) return t("time.left.underMinute");
  return left.hours > 0 ? t("time.left.hours", { h: left.hours, m: pad(left.minutes) }) : t("time.left.minutes", { m: left.minutes });
}

// End of the current Spotify block (ms) or null; survives reloads (localStorage)
export function useSpotifyBlock() {
  const { t, locale } = useI18n();
  const until = useSyncExternalStore(spotifyBlock.subscribe, spotifyBlock.get, () => null);
  return { until, reason: until ? t("quota.reason", { time: formatBlockEnd(until, undefined, locale) }) : undefined };
}

// Fixed strip while Spotify blocks the app, with a countdown; nothing retries meanwhile
export function QuotaBanner({ until }: { until: number | null }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
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
          {t("quota.title", { time: formatBlockEnd(until, now, locale), left: formatLeft(i18n, until - now) })}
        </p>
        <p className="text-areia">
          {t("quota.body")}{" "}
          <Link href="/setup#erro-quota" className="text-papel underline underline-offset-2">
            {t("quota.learnMore")}
          </Link>
        </p>
      </div>
    </div>
  );
}
