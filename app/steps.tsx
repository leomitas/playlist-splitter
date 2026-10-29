"use client";

import { useI18n } from "./i18n";

const STEPS = ["steps.connect", "steps.choose", "steps.review"] as const;

export function Steps({ current }: { current: number }) {
  const { t } = useI18n();
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label={t("steps.label")}>
      {STEPS.map((key, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={n} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={`h-px w-4 sm:w-8 ${n <= current ? "bg-papel" : "bg-fio"}`} />}
            <span
              aria-hidden
              className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                state === "current"
                  ? "bg-papel text-cafe"
                  : state === "done"
                    ? "border border-papel text-papel"
                    : "border border-fio text-areia"
              }`}
            >
              {state === "done" ? "✓" : n}
            </span>
            <span className={state === "current" ? "font-bold" : "sr-only text-areia md:not-sr-only"}>
              {t(key)}
              {state === "done" && <span className="sr-only"> {t("steps.done")}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
