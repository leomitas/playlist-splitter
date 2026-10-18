"use client";

import { memo } from "react";
import type { ItemStatus } from "./analysis-queue";

type Item = { id: string; name: string };
export type RowStatus = { status: ItemStatus; text: string };

const TONE: Record<ItemStatus, string> = {
  pendente: "text-areia",
  analisando: "text-papel",
  concluída: "text-ok",
  erro: "text-erro",
  cancelada: "text-areia",
};

const NO_STATUS = new Map<string, RowStatus>();

// Memoized so toggling one playlist (or a progress tick on another) re-renders only its row
const PickerRow = memo(function PickerRow({
  id,
  name,
  checked,
  disabled,
  status,
  text,
  reprocessDisabledReason,
  onToggle,
  onReprocess,
}: Item & {
  checked: boolean;
  disabled: boolean;
  status?: ItemStatus;
  text?: string;
  reprocessDisabledReason?: string;
  onToggle: (id: string) => void;
  onReprocess: (id: string) => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md pr-2 transition-colors hover:bg-grafite-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5 pl-2 has-disabled:cursor-not-allowed">
        <input type="checkbox" className="check" checked={checked} disabled={disabled} onChange={() => onToggle(id)} />
        <span className="flex min-w-0 flex-col">
          <span className={`truncate ${checked ? "" : "text-areia"}`}>{name}</span>
          {status && (
            <span className={`truncate text-xs ${TONE[status]}`}>
              {status === "analisando" && (
                <span aria-hidden className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-papel align-middle" />
              )}
              {status === "concluída" && "✓ "}
              {text}
            </span>
          )}
        </span>
      </label>
      {(status === "erro" || status === "cancelada") && (
        <button
          className="flex-none rounded-full border border-fio px-2.5 py-0.5 text-xs transition-colors hover:border-areia hover:bg-grafite-2 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!!reprocessDisabledReason}
          title={reprocessDisabledReason}
          onClick={() => onReprocess(id)}
        >
          Reprocessar
        </button>
      )}
    </li>
  );
});

export function PlaylistPicker({
  playlists,
  selected,
  disabled,
  status = NO_STATUS,
  reprocessDisabledReason,
  onToggle,
  onSetAll,
  onReprocess,
}: {
  playlists: Item[];
  selected: Set<string>;
  disabled: boolean;
  // analysis status of the playlists in the current run
  status?: Map<string, RowStatus>;
  // e.g. Spotify blocked the app
  reprocessDisabledReason?: string;
  onToggle: (id: string) => void;
  onSetAll: (ids: string[]) => void;
  onReprocess: (id: string) => void;
}) {
  const selectedCount = playlists.filter((p) => selected.has(p.id)).length;
  const allSelected = playlists.length > 0 && selectedCount === playlists.length;

  if (playlists.length === 0) {
    return <p className="text-sm text-areia">Nenhuma playlist sua ou colaborativa encontrada.</p>;
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-fio bg-grafite p-2 lg:min-h-40 lg:flex-1">
      <label className="flex flex-none cursor-pointer items-center gap-3 border-b border-fio px-2 pt-1 pb-2.5 has-disabled:cursor-not-allowed">
        <input
          type="checkbox"
          className="check"
          checked={allSelected}
          disabled={disabled}
          onChange={() => onSetAll(allSelected ? [] : playlists.map((p) => p.id))}
        />
        <span className="font-bold">Selecionar todas</span>
        <span className="ml-auto text-sm text-areia">
          {selectedCount} de {playlists.length}
        </span>
      </label>
      <ul className="flex max-h-[50vh] min-h-0 flex-col overflow-y-auto lg:max-h-none lg:flex-1">
        {playlists.map((p) => {
          const s = status.get(p.id);
          return (
            <PickerRow
              key={p.id}
              id={p.id}
              name={p.name}
              checked={selected.has(p.id)}
              disabled={disabled}
              status={s?.status}
              text={s?.text}
              reprocessDisabledReason={reprocessDisabledReason}
              onToggle={onToggle}
              onReprocess={onReprocess}
            />
          );
        })}
      </ul>
    </div>
  );
}
