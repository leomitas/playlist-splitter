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
  // group id -> group it was merged into, so tracks arriving later follow the merge
  aliases: Record<string, string>;
};

export type Action =
  | { type: "toggleInclude"; groupId: string }
  | { type: "rename"; groupId: string; name: string }
  | { type: "move"; trackKey: string; toGroupId: string }
  | { type: "merge"; fromId: string; intoId: string }
  | { type: "restoreAutoMoved"; family: string }
  | { type: "addTracks"; tracks: ClassifiedTrack[] }
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
  return { groups, autoMoved, aliases: {} };
}

// same object when the key isn't there, so memoized cards don't see a change
function withoutKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const copy = { ...record };
  delete copy[key];
  return copy;
}

// Adds tracks that arrived after the preview was built, keeping every user choice:
// renamed/included groups stay as they are, merges are followed, moved tracks aren't touched.
function addTracks(state: PreviewState, tracks: ClassifiedTrack[]): PreviewState {
  const known = new Set(state.groups.flatMap((g) => g.trackKeys));
  const groups = state.groups.map((g) => ({ ...g, trackKeys: [...g.trackKeys] }));
  const autoMoved = { ...state.autoMoved };
  const find = (id: string) => groups.find((g) => g.id === (state.aliases[id] ?? id));
  // "Outros" can itself have been merged into another group
  const otherGroup = () => {
    let g = find(OTHER);
    if (!g) groups.push((g = { id: OTHER, name: OTHER, include: false, trackKeys: [] }));
    return g;
  };

  for (const t of tracks) {
    if (known.has(t.key)) continue;
    known.add(t.key);

    const target = t.family === OTHER ? otherGroup() : find(t.family);
    if (target) {
      target.trackKeys.push(t.key);
      continue;
    }

    // family without a group yet: wait in "Outros" until it reaches the minimum size
    const waiting = Object.keys(autoMoved).filter((k) => autoMoved[k] === t.family);
    if (waiting.length + 1 < MIN_GROUP_SIZE) {
      otherGroup().trackKeys.push(t.key);
      autoMoved[t.key] = t.family;
      continue;
    }
    const moved = new Set(waiting);
    for (const g of groups) g.trackKeys = g.trackKeys.filter((k) => !moved.has(k));
    for (const k of waiting) delete autoMoved[k];
    const group = { id: t.family, name: t.family, include: false, trackKeys: [...waiting, t.key] };
    // new groups go before "Outros", which stays last
    const otherIndex = groups.findIndex((g) => g.id === OTHER);
    groups.splice(otherIndex === -1 ? groups.length : otherIndex, 0, group);
  }
  return { ...state, groups, autoMoved };
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
      // untouched groups keep their identity, so memoized group cards don't re-render
      const groups = state.groups.map((g) => {
        const has = g.trackKeys.includes(action.trackKey);
        const rest = has ? g.trackKeys.filter((k) => k !== action.trackKey) : g.trackKeys;
        if (g.id === action.toGroupId) return { ...g, trackKeys: [...rest, action.trackKey] };
        return has ? { ...g, trackKeys: rest } : g;
      });
      // a manual move overrides the automatic suggestion
      return { ...state, groups, autoMoved: withoutKey(state.autoMoved, action.trackKey) };
    }

    case "merge": {
      if (action.fromId === action.intoId) return state;
      const from = state.groups.find((g) => g.id === action.fromId);
      if (!from) return state;
      // earlier merges into fromId now point at intoId as well
      const aliases = Object.fromEntries(
        Object.entries(state.aliases).map(([k, v]) => [k, v === action.fromId ? action.intoId : v]),
      );
      aliases[action.fromId] = action.intoId;
      return {
        ...state,
        aliases,
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
      return { ...state, groups, autoMoved };
    }

    case "addTracks":
      return addTracks(state, action.tracks);

    case "reset":
      return action.state;
  }
}
