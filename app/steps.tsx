const STEPS = ["Conectar", "Escolher e analisar", "Revisar e criar"];

export function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Etapas">
      {STEPS.map((label, i) => {
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
              {label}
              {state === "done" && <span className="sr-only"> (concluído)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
