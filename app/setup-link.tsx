"use client";

import Link from "next/link";
import { useI18n } from "./i18n";

// Header link to the setup guide: full label from sm up, short one on phones; the accessible
// name is always the full one
export function SetupLink() {
  const { t } = useI18n();
  return (
    <Link
      href="/setup"
      aria-label={t("setupLink.full")}
      className="flex-none text-sm text-areia underline-offset-4 transition-colors hover:text-papel hover:underline"
    >
      <span className="hidden sm:inline">{t("setupLink.full")}</span>
      <span className="sm:hidden">{t("setupLink.short")}</span>
    </Link>
  );
}
