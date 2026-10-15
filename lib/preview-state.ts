import type { ClassifiedTrack } from "@/lib/classify";
import { OTHER } from "@/lib/genre-families";

const MIN_GROUP_SIZE = 3;

export type Group = {
  id: string;
  name: string;
  include: boolean;
  trackKeys: string[];
};

export type PreviewState = {
  groups: Group[];
  // trackKey -> family it was auto-moved from (groups under MIN_GROUP_SIZE go to "Outros")
  autoMoved: Record<string, string>;
};

export type Action =
  | { type: "toggleInclude"; groupId: string }
  | { type: "rename"; groupId: string; name: string }
  | { type: "move"; trackKey: string; toGroupId: string }
  | { type: "merge"; fromId: string; intoId: string }
  | { type: "restoreAutoMoved"; family: string }
  | { type: "reset"; state: PreviewState };

export function initialState(tracks: ClassifiedTrack[]): PreviewState {
  const byFamily = new Map<string, string[]>();
  for (const t of tracks) {
    byFamily.set(t.family, [...(byFamily.get(t.family) ?? []), t.key]);
  }

  const autoMoved: Record<string, string> = {};
  const other = byFamily.get(OTHER) ?? [];
  for (const [family, keys] of byFamily) {
    if (family === OTHER || keys.length >= MIN_GROUP_SIZE) continue;
    for (const k of keys) autoMoved[k] = family;
    other.push(...keys);
    byFamily.delete(family);
  }

  const groups: Group[] = [...byFamily.entries()]
    .filter(([family]) => family !== OTHER)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([family, keys]) => ({ id: family, name: family, include: false, trackKeys: keys }));
  // always present so any track can be moved there
  groups.push({ id: OTHER, name: OTHER, include: false, trackKeys: other });
  // only the largest group starts selected ("Outros" is last, so only if it's the only one)
  const first = groups.find((g) => g.trackKeys.length > 0);
  if (first) first.include = true;
  return { groups, autoMoved };
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

export function reducer(state: PreviewState, action: Action): PreviewState {
  switch (action.type) {
    case "toggleInclude":
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === action.groupId ? { ...g, include: !g.include } : g)),
      };

    case "rename":
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === action.groupId ? { ...g, name: action.name } : g)),
      };

    case "move": {
      const groups = state.groups.map((g) => {
        const rest = g.trackKeys.filter((k) => k !== action.trackKey);
        return g.id === action.toGroupId ? { ...g, trackKeys: [...rest, action.trackKey] } : { ...g, trackKeys: rest };
      });
      // a manual move overrides the automatic suggestion
      return { groups, autoMoved: withoutKey(state.autoMoved, action.trackKey) };
    }

    case "merge": {
      if (action.fromId === action.intoId) return state;
      const from = state.groups.find((g) => g.id === action.fromId);
      if (!from) return state;
      return {
        ...state,
        groups: state.groups
          .filter((g) => g.id !== action.fromId)
          .map((g) => (g.id === action.intoId ? { ...g, trackKeys: [...g.trackKeys, ...from.trackKeys] } : g)),
      };
    }

    case "restoreAutoMoved": {
      const keys = Object.keys(state.autoMoved).filter((k) => state.autoMoved[k] === action.family);
      if (keys.length === 0) return state;
      const autoMoved = keys.reduce(withoutKey, state.autoMoved);
      const groups = state.groups.map((g) => ({
        ...g,
        trackKeys: g.trackKeys.filter((k) => !keys.includes(k)),
      }));
      const existing = groups.find((g) => g.id === action.family);
      if (existing) existing.trackKeys.push(...keys);
      else groups.push({ id: action.family, name: action.family, include: true, trackKeys: keys });
      return { groups, autoMoved };
    }

    case "reset":
      return action.state;
  }
}
