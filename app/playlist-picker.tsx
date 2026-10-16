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
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(id)} />
        <span>{name}</span>
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

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 border-b pb-1 font-medium">
        <input
          type="checkbox"
          checked={allSelected}
          disabled={disabled || playlists.length === 0}
          onChange={() => onSetAll(allSelected ? [] : playlists.map((p) => p.id))}
        />
        <span>
          Selecionar todas ({selectedCount} de {playlists.length})
        </span>
      </label>
      <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
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
