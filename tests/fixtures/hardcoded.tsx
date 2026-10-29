// Fixture for tests/no-hardcoded-text.test.ts: each marked line must be reported, the rest not.
// Never imported.
"use client";

import { useState } from "react";

const LABELS = { light: "Claro" }; // string (Portuguese-only word)
const status = "concluída"; // allowed: state code

export function Hardcoded({ count }: { count: number }) {
  const [v] = useState("");
  return (
    <div className="flex gap-2 text-areia" data-x={status}>
      <p>Olá</p> {/* JSX text */}
      <input aria-label="Buscar" placeholder="Search" value={v} readOnly /> {/* aria-label, placeholder */}
      <span title={LABELS.light}>{`${count} selecionadas`}</span> {/* template */}
      <span>{"Nenhuma faixa"}</span> {/* string */}
      <span>Playlist Splitter</span>
    </div>
  );
}
