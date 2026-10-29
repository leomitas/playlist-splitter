// Genre -> playlist id per account, written when the app creates or updates a playlist. In the
// "state" store, so "Limpar cache" keeps it. No server actions here: the review imports it.

import type { GenreTargets } from "@/lib/existing-playlists";
import { idbGet, idbSet } from "@/lib/idb";

const targetsKey = (myId: string) => `genre-targets:${myId}`;

export const loadGenreTargets = async (myId: string): Promise<GenreTargets> =>
  (await idbGet<GenreTargets>("state", targetsKey(myId))) ?? {};

export async function rememberGenreTarget(myId: string, groupId: string, playlistId: string) {
  const current = await loadGenreTargets(myId);
  if (current[groupId] !== playlistId) await idbSet("state", targetsKey(myId), { ...current, [groupId]: playlistId });
}
