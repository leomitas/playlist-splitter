// Long Spotify bans: a 429 whose Retry-After is over BLOCK_THRESHOLD_S (e.g. QUOTA_EXCEEDED in
// Development Mode) is not a pause but a block, and retrying only extends it. The end time is
// kept in localStorage so a reload still refuses every Spotify call until then.

export const BLOCK_THRESHOLD_S = 120;
const KEY = "spotify-blocked-until";
// setTimeout's maximum delay (~24.8 days)
const MAX_TIMER_MS = 2 ** 31 - 1;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export type BlockStore = ReturnType<typeof createBlockStore>;

export function createBlockStore(storage: () => StorageLike | null = browserStorage, now: () => number = Date.now) {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let until: number | null = null;

  const notify = () => listeners.forEach((l) => l());

  function store(next: number | null) {
    until = next !== null && next > now() ? next : null;
    clearTimeout(timer);
    // wake the UI up when the block ends, even if nothing else happens
    if (until !== null) timer = setTimeout(() => apply(null), Math.min(MAX_TIMER_MS, until - now()));
  }

  function apply(next: number | null) {
    store(next);
    notify();
  }

  function load() {
    try {
      const raw = Number(storage()?.getItem(KEY));
      return Number.isFinite(raw) && raw > now() ? raw : null;
    } catch {
      return null;
    }
  }

  let loaded = false;
  const ensureLoaded = () => {
    if (loaded) return;
    loaded = true;
    // no notify: get() runs during render
    store(load());
  };

  return {
    // end of the block (ms) or null; expired blocks read as null. Safe to call during render.
    get(): number | null {
      ensureLoaded();
      return until !== null && until > now() ? until : null;
    },
    set(untilMs: number) {
      ensureLoaded();
      // a later answer never shortens a block already known
      apply(Math.max(untilMs, until ?? 0));
      try {
        storage()?.setItem(KEY, String(until));
      } catch {
        // storage blocked: the block still holds for this page load
      }
    },
    clear() {
      apply(null);
      try {
        storage()?.removeItem(KEY);
      } catch {
        // ignore
      }
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

// "14:05" today, "18/10 14:05" on another day
export function formatBlockEnd(until: number, now = Date.now()) {
  const d = new Date(until);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Date(now).toDateString() === d.toDateString() ? time : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}

// "2h 05m", "12m", "menos de 1m"
export function formatBlockLeft(ms: number) {
  const min = Math.ceil(ms / 60000);
  if (min < 1) return "menos de 1m";
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${pad(min % 60)}m` : `${min}m`;
}

export const blockedReason = (until: number) => `Spotify bloqueado até ${formatBlockEnd(until)}`;
