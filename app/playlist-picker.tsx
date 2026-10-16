"use client";

type Item = { id: string; name: string };

export function PlaylistPicker({
  playlists,
  selected,
  disabled,
  onChange,
}: {
  playlists: Item[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const allSelected = playlists.length > 0 && playlists.every((p) => selected.includes(p.id));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 border-b pb-1 font-medium">
        <input
          type="checkbox"
          checked={allSelected}
          disabled={disabled || playlists.length === 0}
          onChange={() => onChange(allSelected ? [] : playlists.map((p) => p.id))}
        />
        <span>
          Selecionar todas ({selected.length} de {playlists.length})
        </span>
      </label>
      <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
        {playlists.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                disabled={disabled}
                onChange={() => toggle(p.id)}
              />
              <span>{p.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
