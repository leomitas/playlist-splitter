"use client";

type Item = { id: string; name: string };

export function PlaylistPicker({
  playlists,
  selected,
  max,
  onToggle,
}: {
  playlists: Item[];
  selected: string[];
  max: number;
  onToggle: (id: string) => void;
}) {
  const full = selected.length >= max;
  return (
    <div className="flex flex-col gap-1">
      {full && (
        <p className="text-xs text-yellow-800">Limite de {max} playlists por análise atingido.</p>
      )}
      <ul className="flex flex-col gap-1">
        {playlists.map((p) => {
          const checked = selected.includes(p.id);
          return (
            <li key={p.id}>
              <label className={`flex items-center gap-2 ${!checked && full ? "opacity-50" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => onToggle(p.id)}
                />
                <span>{p.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
