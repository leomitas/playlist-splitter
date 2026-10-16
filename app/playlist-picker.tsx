"use client";

import { memo } from "react";

type Item = { id: string; name: string };

// Memoized so toggling one playlist re-renders only its row
const PickerRow = memo(function PickerRow({
  id,
  name,
  checked,
  disabled,
  onToggle,
}: Item & { checked: boolean; disabled: boolean; onToggle: (id: string) => void }) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-grafite-2 has-disabled:cursor-not-allowed">
        <input type="checkbox" className="check" checked={checked} disabled={disabled} onChange={() => onToggle(id)} />
        <span className={`min-w-0 truncate ${checked ? "" : "text-areia"}`}>{name}</span>
      </label>
    </li>
  );
});

export function PlaylistPicker({
  playlists,
  selected,
  disabled,
  onToggle,
  onSetAll,
}: {
  playlists: Item[];
  selected: Set<string>;
  disabled: boolean;
  onToggle: (id: string) => void;
  onSetAll: (ids: string[]) => void;
}) {
  const selectedCount = playlists.filter((p) => selected.has(p.id)).length;
  const allSelected = playlists.length > 0 && selectedCount === playlists.length;

  if (playlists.length === 0) {
    return <p className="text-sm text-areia">Nenhuma playlist sua ou colaborativa encontrada.</p>;
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-fio bg-grafite p-2">
      <label className="flex cursor-pointer items-center gap-3 border-b border-fio px-2 pt-1 pb-2.5 has-disabled:cursor-not-allowed">
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
      <ul className="flex max-h-[40vh] flex-col overflow-auto lg:max-h-[45dvh]">
        {playlists.map((p) => (
          <PickerRow
            key={p.id}
            id={p.id}
            name={p.name}
            checked={selected.has(p.id)}
            disabled={disabled}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  );
}
