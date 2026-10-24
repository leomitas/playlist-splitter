"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { applyArtistConsensus } from "@/lib/artist-consensus";
import { applyCountries, artistsNeedingCountry } from "@/lib/country";
import { markIncoherent } from "@/lib/classify";
import { isSplitterPlaylist } from "@/lib/playlist-plan";
import { isReadablePlaylist, LIKED_ID, type ApiResult, type LikedSummary, type Me, type Playlist } from "@/lib/spotify";
import { AnalysisPanel, itemStatus } from "./analysis-panel";
import { analysis, previewStorageKey } from "./analysis-queue";
import { countryLookup } from "./country-lookup";
import { useHeightVar } from "./height-var";
import { PlaylistPicker } from "./playlist-picker";
import { Preferences } from "./preferences";
import { Preview } from "./preview";
import { QuotaBanner, useSpotifyBlock } from "./quota-banner";
import { RawError } from "./raw-error";
import { SetupLink } from "./setup-link";
import { Steps } from "./steps";
import { useI18n, useRevealText } from "./i18n";
import { likedAsPlaylist, loadLikedSummary, loadMe, loadPlaylists } from "./spotify-data";

export function SpotifyApp({ logout }: { logout: React.ReactNode }) {
  const i18n = useI18n();
  const { t } = i18n;
  useRevealText();
  const [me, setMe] = useState<ApiResult<Me> | null>(null);
  const [playlists, setPlaylists] = useState<ApiResult<Playlist[]> | null>(null);
  const [liked, setLiked] = useState<ApiResult<LikedSummary> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // local state only: nothing in the URL, so a reload doesn't trigger any call by itself
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [cacheCleared, setCacheCleared] = useState(false);
  const run = useSyncExternalStore(analysis.subscribe, analysis.get, () => null);
  const block = useSpotifyBlock();
  const headerRef = useHeightVar("--app-header-h");

  const refreshPlaylists = useCallback(async (force: boolean) => {
    setRefreshing(true);
    setPlaylists(await loadPlaylists(force));
    setLiked(await loadLikedSummary(force));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void analysis.restore();
    void (async () => {
      setMe(await loadMe());
      await refreshPlaylists(false);
    })();
  }, [refreshPlaylists]);

  const countries = useSyncExternalStore(countryLookup.subscribe, countryLookup.get, countryLookup.get);

  // Bumped only when the analysis or the country lookup *finishes*, so the genre cards are
  // sorted then and never while the user is editing them (adjusted during render)
  const [reorderToken, setReorderToken] = useState(0);
  const [phases, setPhases] = useState({ run: run?.phase, countries: countries.phase });
  if (phases.run !== run?.phase || phases.countries !== countries.phase) {
    const finished =
      (run?.phase === "done" && phases.run !== "done") || (countries.phase === "done" && phases.countries !== "done");
    setPhases({ run: run?.phase, countries: countries.phase });
    if (finished) setReorderToken((n) => n + 1);
  }

  // Artist countries, coherence flags and the artist consensus depend on the whole set, so
  // they're recomputed as tracks (or countries) arrive, in that order: the country decides the
  // bare "funk" tag, and the consensus uses the coherence flags
  const { tracks, consensus } = useMemo(() => {
    const copy = (run?.tracks ?? []).map((t) => ({ ...t }));
    applyCountries(copy, countries.countries);
    markIncoherent(copy);
    return { tracks: copy, consensus: applyArtistConsensus(copy) };
  }, [run?.tracks, countries.countries]);

  // artists with only the bare "funk" tag: their country is looked up once the analysis is idle
  const needCountry = useMemo(() => artistsNeedingCountry(run?.tracks ?? []), [run?.tracks]);
  const analyzing = run?.phase === "running" || run?.phase === "paused";
  useEffect(() => {
    if (!analyzing && needCountry.size > 0) void countryLookup.ensure(needCountry);
  }, [needCountry, analyzing]);

  // the API doesn't return items for playlists the user neither owns nor collaborates on
  // liked songs first; playlists created by this app are left out so they aren't re-analyzed
  const readable = useMemo(
    () =>
      me?.ok && playlists?.ok
        ? [
            ...(liked?.ok ? [likedAsPlaylist(liked.data, me.data)] : []),
            ...playlists.data.filter((p) => isReadablePlaylist(p, me.data.id) && !isSplitterPlaylist(p, me.data.id)),
          ]
        : [],
    [me, playlists, liked],
  );
  const pickerItems = useMemo(
    () =>
      readable.map((p) => ({
        id: p.id,
        name: liked?.ok && p.id === LIKED_ID ? t("liked.nameCount", { count: liked.data.total }) : p.name,
        snapshotId: p.snapshot_id,
      })),
    [readable, liked, t],
  );
  // status and snapshot per playlist in the current run, for the picker's quick filters
  const analysisInfo = useMemo(
    () => new Map(run?.items.map((i) => [i.id, { status: i.status, snapshotId: i.snapshotId }])),
    [run?.items],
  );
  // drop selections that disappeared after "Atualizar lista"
  const chosen = useMemo(() => readable.filter((p) => selected.has(p.id)), [readable, selected]);

  // writes patched the session's playlist list, so this reads it back without a new listing
  const onSpotifyChanged = useCallback(() => refreshPlaylists(false), [refreshPlaylists]);

  // per-playlist analysis status, shown next to each playlist in the list
  const statusById = useMemo(() => new Map(run?.items.map((i) => [i.id, itemStatus(i18n, run, i)])), [run, i18n]);

  const active = run?.phase === "running" || run?.phase === "paused";
  const syncing = run?.sync?.state === "lendo" || run?.sync?.state === "gêneros";
  const busy = active || syncing;
  const step = run && tracks.length > 0 && !active ? 3 : 2;

  if (!me) return <AppSkeleton logout={logout} />;

  async function clearCache() {
    await analysis.clearCache();
    countryLookup.reset();
    setCacheCleared(true);
    // a blocked Spotify can't list; the list on screen stays until "Atualizar"
    if (!block.until) await refreshPlaylists(true);
  }

  async function syncLiked() {
    await analysis.syncLiked();
    setLiked(await loadLikedSummary());
  }

  function fullReanalyze() {
    if (!run) return;
    const ids = new Set(run.items.map((i) => i.id));
    const again = readable.filter((p) => ids.has(p.id));
    if (again.length === 0) return;
    if (!window.confirm(t("app.confirmFullReanalysis"))) return;
    setCacheCleared(false);
    void analysis.fullReanalyze(again);
  }

  return (
    <div className="flex w-full flex-1 flex-col self-stretch">
      <header ref={headerRef} className="z-20 border-b border-fio bg-cafe/95 backdrop-blur lg:sticky lg:top-0">
        <QuotaBanner until={block.until} />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
          <h1 className="wide text-lg sm:text-xl">Playlist Splitter</h1>
          <div className="order-last w-full lg:order-none lg:w-auto">
            <Steps current={step} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            {me.ok && (
              <>
                {me.data.images?.[0] && (
                  <Image src={me.data.images[0].url} alt="" width={32} height={32} className="size-8 rounded-full" />
                )}
                <span className="hidden max-w-40 truncate text-sm sm:inline" title={me.data.email ?? undefined}>
                  {me.data.display_name ?? t("common.noName")}
                </span>
              </>
            )}
            <Preferences />
            <SetupLink />
            {logout}
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 flex-1 items-start gap-8 px-4 pt-6 pb-36 sm:px-6 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-12 lg:pb-0">
        {/* desktop: fits between the header and the bottom bar; only the playlist list scrolls, the analysis
            stays in view. The sticky offset equals the grid's top padding (pt-6), so it sits at the same
            place at scroll 0 and once stuck. The bottom padding sits on the section (lg:pb-36) so the
            sticky aside is never pushed up behind the header at the end of the page */}
        <aside
          className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--app-header-h,0px)+--spacing(6))] lg:h-[calc(100dvh-var(--app-header-h,0px)-var(--app-footer-h,0px)-(--spacing(10)))]"
          aria-label={t("steps.choose")}
        >
          {!me.ok && <RawError error={me} />}

          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">
              {t("app.yourPlaylists")}{" "}
              {playlists?.ok && <span className="font-normal text-areia">{readable.length}</span>}
            </h2>
            <div className="flex gap-3 text-sm">
              <button
                className="text-areia underline-offset-4 transition-colors hover:text-papel hover:underline disabled:opacity-40 disabled:hover:no-underline"
                disabled={refreshing || !!block.reason}
                title={block.reason}
                onClick={() => refreshPlaylists(true)}
              >
                {refreshing ? t("app.refreshing") : t("app.refresh")}
              </button>
              <button
                className="text-areia underline-offset-4 transition-colors hover:text-papel hover:underline disabled:opacity-40 disabled:hover:no-underline"
                disabled={busy}
                onClick={clearCache}
                title={t("app.clearCacheTitle")}
              >
                {cacheCleared ? t("app.cacheCleared") : t("app.clearCache")}
              </button>
            </div>
          </div>

          {!playlists ? (
            <PickerSkeleton />
          ) : !playlists.ok ? (
            <RawError error={playlists} />
          ) : !me.ok ? (
            <p className="text-sm text-erro">{t("app.noUserId")}</p>
          ) : (
            <>
              {liked && !liked.ok && (
                <div className="flex flex-col gap-1 text-sm">
                  <p>{t("app.likedFailed")}</p>
                  <RawError error={liked} />
                </div>
              )}
              <PlaylistPicker
                playlists={pickerItems}
                selected={selected}
                disabled={busy}
                status={statusById}
                reprocessDisabledReason={block.reason}
                analysis={analysisInfo}
                onSelect={setSelected}
                onReprocess={analysis.reprocess}
              />
            </>
          )}

          <button
            className="flex-none rounded-full bg-papel px-5 py-3 font-bold text-cafe transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || chosen.length === 0 || !!block.reason}
            title={block.reason}
            onClick={() => {
              setCacheCleared(false);
              analysis.start(chosen);
            }}
          >
            {block.reason ??
              (chosen.length === 0 ? t("app.choosePlaylists") : t("app.analyze", { count: chosen.length }))}
          </button>
          {active && <p className="-mt-3 text-sm text-areia">{t("app.cancelFirst")}</p>}

          {run && (
            <AnalysisPanel
              run={run}
              blockedReason={block.reason}
              onPause={analysis.pause}
              onResume={() => analysis.resume(readable)}
              onCancel={analysis.cancel}
              onReprocess={analysis.reprocess}
              onSyncLiked={syncLiked}
              onFullReanalyze={fullReanalyze}
              countries={countries}
              countryArtists={needCountry}
            />
          )}
        </aside>

        <section className="flex min-w-0 flex-col gap-6 lg:pb-36" aria-label={t("steps.review")}>
          {run && tracks.length > 0 ? (
            <Preview
              key={run.id}
              tracks={tracks}
              duplicates={run.totalTracks - tracks.length}
              consensus={consensus}
              storageKey={previewStorageKey(run.id)}
              createDisabledReason={block.reason ?? (busy ? t("app.waitAnalysis") : undefined)}
              onSpotifyChanged={onSpotifyChanged}
              reorderToken={reorderToken}
            />
          ) : active ? (
            <SpectrumSkeleton text={t("app.readingFirst")} />
          ) : (
            <SpectrumSkeleton text={t("app.emptyHint")} still />
          )}
        </section>
      </div>
    </div>
  );
}

function PickerSkeleton() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3" aria-label={t("app.loadingPlaylists")}>
      {[70, 55, 80, 45, 65, 50].map((w, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton size-6" />
          <div className="skeleton h-4" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

// Grey bands in the shape of the spectrum: loading (pulsing) or empty (still)
function SpectrumSkeleton({ text, still }: { text: string; still?: boolean }) {
  const bands = [30, 18, 14, 11, 9, 7, 6, 5];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-16 gap-1 overflow-hidden rounded-lg" aria-hidden>
        {bands.map((w, i) => (
          <div
            key={i}
            className={still ? "rounded-sm bg-grafite-2" : "skeleton rounded-sm"}
            style={{ flexGrow: w, opacity: still ? 1 - i * 0.09 : undefined }}
          />
        ))}
      </div>
      <p className="max-w-[48ch] text-lg text-areia">{text}</p>
    </div>
  );
}

function AppSkeleton({ logout }: { logout: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex w-full flex-1 flex-col self-stretch" aria-busy>
      <header className="border-b border-fio">
        <div className="mx-auto flex max-w-7xl items-center gap-8 px-4 py-3 sm:px-6">
          <h1 className="wide text-lg sm:text-xl">Playlist Splitter</h1>
          <div className="ml-auto flex items-center gap-3">
            <Preferences />
            {logout}
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 px-4 pt-6 sm:px-6 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-12">
        <PickerSkeleton />
        <SpectrumSkeleton text={t("app.loadingProfile")} />
      </div>
    </div>
  );
}
