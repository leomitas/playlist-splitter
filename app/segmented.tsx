"use client";

import { useRef } from "react";

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode };

const NEXT: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

// Radio group drawn as one pill: Tab enters on the checked option and leaves the group (roving
// tabindex); arrows, Home and End move and select, like native radios
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  small,
  className = "",
}: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  // header size: smaller text and padding
  small?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function select(index: number) {
    const i = (index + options.length) % options.length;
    refs.current[i]?.focus();
    if (options[i].value !== value) onChange(options[i].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex flex-wrap gap-0.5 rounded-2xl border border-fio bg-cafe p-0.5 ${small ? "text-xs" : "text-sm"} ${className}`}
      onKeyDown={(e) => {
        const step = NEXT[e.key];
        const current = refs.current.findIndex((r) => r === document.activeElement);
        if (current === -1) return;
        if (step) select(current + step);
        else if (e.key === "Home") select(0);
        else if (e.key === "End") select(options.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {options.map((o, i) => {
        const on = i === checked;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`rounded-full whitespace-nowrap transition-colors ${small ? "px-2.5 py-0.5" : "px-3 py-1"} ${
              on ? "bg-papel font-bold text-cafe" : "text-areia hover:bg-grafite-2 hover:text-papel"
            }`}
            onClick={() => select(i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
