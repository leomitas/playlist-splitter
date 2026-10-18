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
  // tracks the user moved; nothing automatic ever moves them again
  manual: Record<string, true>;
  // trackKey -> family it was placed with when that family differs from the tags' own (artist
  // consensus or the artist's country); the name predates the country rule and is kept for
  // saved states
  inferredPlaced: Record<string, string>;
};

export type Action =
  | { type: "toggleInclude"; groupId: string }
  | { type: "rename"; groupId: string; name: string }
  | { type: "move"; trackKey: string; toGroupId: string }
  | { type: "moveMany"; trackKeys: string[]; toGroupId: string }
  | { type: "createGroup"; name: string; trackKeys: string[] }
  | { type: "merge"; fromId: string; intoId: string }
  | { type: "restoreAutoMoved"; family: string }
  // new tracks arrived and/or the artist consensus changed some families
  | { type: "sync"; tracks: ClassifiedTrack[] }
  | { type: "reset"; state: PreviewState };

// Family from the tags alone, before country and consensus adjustments
const tagFamily = (t: ClassifiedTrack) => t.baseFamily ?? t.inferredFrom?.family ?? t.family;
const isAdjusted = (t: ClassifiedTrack) => t.family !== tagFamily(t);

// Family the track is placed with now: the adjusted one it was placed with, else its tags' own
const placedFamily = (state: PreviewState, t: ClassifiedTrack) => state.inferredPlaced[t.key] ?? tagFamily(t);

// Tracks to add (unknown) or to re-place (family changed since placement, not moved by hand)
export function pendingSync(state: PreviewState, tracks: ClassifiedTrack[]) {
  const known = new Set(state.groups.flatMap((g) => g.trackKeys));
  return tracks.filter((t) => !known.has(t.key) || (!state.manual[t.key] && placedFamily(state, t) !== t.family));
}

const inferredOf = (tracks: ClassifiedTrack[]) =>
  Object.fromEntries(tracks.filter(isAdjusted).map((t) => [t.key, t.family]));

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
  return { groups, autoMoved, aliases: {}, manual: {}, inferredPlaced: inferredOf(tracks) };
}

// Saved states from before `manual`/`inferredPlaced` existed: their inferred tracks count as
// already placed, since a move made back then can't be told apart from an automatic placement
export function upgradeSaved(saved: Partial<PreviewState> & Pick<PreviewState, "groups">, tracks: ClassifiedTrack[]): PreviewState {
  return {
    groups: saved.groups,
    autoMoved: saved.autoMoved ?? {},
    aliases: saved.aliases ?? {},
    manual: saved.manual ?? {},
    inferredPlaced: saved.inferredPlaced ?? inferredOf(tracks),
  };
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

// Takes re-placed tracks out of their group, then places them (and the new ones) again
function sync(state: PreviewState, tracks: ClassifiedTrack[]): PreviewState {
  const todo = pendingSync(state, tracks);
  if (todo.length === 0) return state;
  const keys = new Set(todo.map((t) => t.key));
  const inferredPlaced = { ...state.inferredPlaced };
  for (const t of todo) {
    if (isAdjusted(t)) inferredPlaced[t.key] = t.family;
    else delete inferredPlaced[t.key];
  }
  const cleared: PreviewState = {
    ...state,
    inferredPlaced,
    autoMoved: Object.fromEntries(Object.entries(state.autoMoved).filter(([k]) => !keys.has(k))),
    groups: state.groups.map((g) =>
      g.trackKeys.some((k) => keys.has(k)) ? { ...g, trackKeys: g.trackKeys.filter((k) => !keys.has(k)) } : g,
    ),
  };
  return addTracks(cleared, todo);
}

// Moves tracks into a group (created when it's "Outros" and it doesn't exist); marks them manual
function moveMany(state: PreviewState, trackKeys: string[], toGroupId: string): PreviewState {
  const keys = new Set(trackKeys);
  if (keys.size === 0) return state;
  let groups = state.groups;
  if (!groups.some((g) => g.id === toGroupId)) {
    if (toGroupId !== OTHER) return state;
    groups = [...groups, { id: OTHER, name: OTHER, include: false, trackKeys: [] }];
  }
  const manual = { ...state.manual };
  let autoMoved = state.autoMoved;
  for (const k of keys) {
    manual[k] = true;
    autoMoved = withoutKey(autoMoved, k);
  }
  return {
    ...state,
    manual,
    autoMoved,
    groups: groups.map((g) => {
      const has = g.trackKeys.some((k) => keys.has(k));
      const rest = has ? g.trackKeys.filter((k) => !keys.has(k)) : g.trackKeys;
      if (g.id === toGroupId) return { ...g, trackKeys: [...rest, ...trackKeys.filter((k) => keys.has(k))] };
      return has ? { ...g, trackKeys: rest } : g;
    }),
  };
}

// User-made groups get an id that can't collide with a family, so new tracks never land there
export function customGroupId(name: string, groups: Group[]) {
  const base = `custom:${name.trim()}`;
  let id = base;
  for (let n = 2; groups.some((g) => g.id === id); n++) id = `${base} ${n}`;
  return id;
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
      return {
        ...state,
        groups,
        autoMoved: withoutKey(state.autoMoved, action.trackKey),
        manual: state.manual[action.trackKey] ? state.manual : { ...state.manual, [action.trackKey]: true },
      };
    }

    case "moveMany":
      return moveMany(state, action.trackKeys, action.toGroupId);

    case "createGroup": {
      const name = action.name.trim();
      if (!name || action.trackKeys.length === 0) return state;
      const id = customGroupId(name, state.groups);
      const group: Group = { id, name, include: true, trackKeys: [] };
      // new groups go before "Outros", which stays last
      const otherIndex = state.groups.findIndex((g) => g.id === OTHER);
      const groups = [...state.groups];
      groups.splice(otherIndex === -1 ? groups.length : otherIndex, 0, group);
      return moveMany({ ...state, groups }, action.trackKeys, id);
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

    case "sync":
      return sync(state, action.tracks);

    case "reset":
      return action.state;
  }
}
