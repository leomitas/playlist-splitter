# Playlist Splitter

**English** · [Português (Brasil)](README.pt-BR.md)

Split the songs of your Spotify playlists (and liked songs) by genre and create one playlist per genre. You review everything first; nothing changes on Spotify until you confirm, and your original playlists are never touched.

> Independent project, not affiliated with or endorsed by Spotify, Last.fm or MusicBrainz.

![Playlist Splitter demo: analysis, genre spectrum, review and creating the playlists](docs/media/demo.gif)

**[Watch the 2-minute demo](https://youtu.be/CVqxI0cqT0M)**

## How it works

1. **Log in with Spotify** using your own Spotify app (see [Spotify limits](#spotify-limits-read-this-first)).
2. **Pick playlists** (and your liked songs). The analysis runs in the background; genres come from Last.fm tags.
3. **Review:** a genre spectrum of everything you picked. Rename, merge or move tracks, check the ones flagged as low confidence, and choose which genres to create.
4. **Confirm.** New genres become new playlists (private by default; **Make the new playlists public** in the confirmation changes that) named like `Rock (Playlist Splitter)`. Genres that already have one are **updated**: only new tracks are appended, nothing is removed or reordered.

Run it again whenever your library changes: playlists the app made are recognized (card badge **Will update**; **New** means a playlist will be created) and updated instead of duplicated.

## Features

- **Genre spectrum** of the selected playlists and liked songs, grouped into families (Rock, Pop, Hip-hop/Rap, Electronic, MPB, Funk BR…).
- **Review before creating:** rename, merge and include/exclude groups; search, filter and move tracks in bulk; one list with every low-confidence track; export the classification as JSON; undo your edits.
- **Existing playlists detected:** each genre card shows **Will update** or **New**; **Check existing** / **Check new** select them in one click, and the confirmation lists what will be updated and what will be created. Detection uses the playlist id saved in your browser (it survives renames) and falls back to the default name in either language. Only playlists you own are considered.
- **Brazilian vs. American funk:** Brazilian funk tags go to **Funk BR**; for artists tagged only "funk", the artist's country (MusicBrainz) decides between **Funk BR** and **International Funk**, and unknown ones wait in **Funk (uncertain)** for review.
- **Duplicates removed** by Spotify id and by identical artist + title (versions such as Remix, Slowed or Live stay).
- **Artist consensus:** when an artist's confident tracks agree on a family, their unclassified or low-confidence tracks follow (never overriding confident tracks or your manual moves).
- **Quota-friendly:** everything read is cached in the browser (IndexedDB); **Sync liked songs** reads only the new likes; playlists the app created are only re-read when their snapshot changed.
- **Blocks handled:** when Spotify blocks the app (429 with a long Retry-After), it stops calling, shows until when, and remembers it across reloads.
- **Background analysis** with pause/resume, per-playlist progress and retries.
- **English and Portuguese (Brazil)** interface, light, dark or system theme.
- **In-app setup guide** at `/setup`, plus `npm run setup:env` and `npm run doctor`.

## Spotify limits (read this first)

There is no hosted version, and that is on purpose: Spotify only lets an app in **Development Mode** serve a handful of people, so every person runs their own copy with their own Spotify app.

- **Each person creates their own Spotify app** in the Developer Dashboard (the `/setup` guide walks through it).
- **Up to 5 users** per app, each registered by e-mail in *User Management* (otherwise every call returns 403).
- **The app owner needs Spotify Premium.**
- **Quota:** Spotify limits how many calls an app makes, and going over can block it for hours (`429`, `QUOTA_EXCEEDED`). The app queues calls one at a time, caches everything and stops on a block instead of retrying. This already happened once while building it.
- **No genres from Spotify:** for apps in Development Mode, Spotify removed the artist `genres` field and the batch endpoints. See [How genres are decided](#how-genres-are-decided).

## Quick start

Requirements: Node.js 20+ and a Spotify Premium account.

```bash
git clone https://github.com/leomitas/playlist-splitter.git
cd playlist-splitter
npm install
npm run setup:env   # creates .env.local (never overwrites) and generates AUTH_SECRET
npm run dev
```

Open **http://127.0.0.1:3000/setup** (always `127.0.0.1`, never `localhost`) and follow the six steps: confirm Spotify Premium, create the Spotify app, register your e-mail, get a Last.fm key, fill `.env.local`, restart. Then `npm run doctor` checks the configuration without printing any value.

For a smoother experience (no dev badge, faster pages) you can run a production build instead of `npm run dev`: `npm run build && npm start`. Stop the server before building again.

## Project status and testing

Playlist Splitter is a young project, built and used so far by one person. Here is what is, and isn't, verified.

**Automated:** 190+ tests (Vitest) with the APIs mocked: classification, duplicates, artist consensus, the review state, i18n, color contrast (WCAG AA in both themes) and the main UI behaviors. CI runs lint, typecheck, tests and a production build on every pull request.

**By hand, against the real APIs** (Windows, Chrome, Spotify Premium, live Last.fm and MusicBrainz): login; analyzing about 90 playlists (around 4,900 unique tracks) and a second account with 9 playlists; creating 15 genre playlists; recognizing them afterwards (**Will update**); updating a playlist; syncing a newly liked song.

**Not verified yet:**

- The block screen against a real Spotify `429` (covered by unit tests only).
- The "Test configuration" button on `/setup` against live services.
- macOS, Linux, Firefox and Safari.
- Accounts other than the author's (Development Mode makes this hard, so reports are very welcome).

Found a problem? Please [open an issue](../../issues) with what you did and the message the app showed.

## How genres are decided

Spotify removed the `genres` field and the batch endpoints (e.g. several artists per request) for apps in **Development Mode**, which is the mode every self-hosted copy of this app runs in. Genres therefore come from **Last.fm tags** of the artist (and of the track, when the artist's tags aren't enough), mapped to families by a simple whitelist in [`lib/genre-families.ts`](lib/genre-families.ts).

The bare tag **"funk"** is ambiguous (funk carioca and American funk share it), so for artists with no Brazilian funk tag the app asks **MusicBrainz** for the artist's country: Brazil → Funk BR, another country → International Funk (still competing with the other tags: R&B/Soul when soul/R&B weighs more, Jazz when jazz does), not found → Funk (uncertain). A country is used only for a confident, exact match (score ≥ 90, same normalized name or alias). MusicBrainz allows **1 request per second**, so these lookups run in the background at that pace (with pause and time left) and are cached in the browser; "not found" is asked again after 14 days.

Tags are crowd-sourced, so some tracks will land in the wrong family or in **Other**. That is what the review step is for, and mapping improvements are the easiest way to contribute.

## Privacy

- **No database and no accounts.** The session lives in an encrypted cookie; what the app reads from Spotify is cached in your browser (IndexedDB) and stays there. **Clear cache** erases it.
- Track and artist names are sent to **Last.fm** (and artist names to **MusicBrainz**, only for the generic "funk" tag) to look up tags and countries, through the app's own server routes on your machine.
- Your Spotify Client Secret, Last.fm key and `AUTH_SECRET` live in `.env.local`, which is never committed. Never paste them in issues or screenshots.
- The app asks Spotify only for the permissions it needs: read your playlists and liked songs, create or edit playlists, and read your account's e-mail (`user-read-email`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `INVALID_CLIENT: Invalid redirect URI` | Register exactly `http://127.0.0.1:3000/api/auth/callback/spotify` in the Dashboard and set `AUTH_URL=http://127.0.0.1:3000`. |
| 403 after login, "user may not be registered" | Add your Spotify e-mail in Dashboard > User Management, then log out and in. |
| 429 / `QUOTA_EXCEEDED` | Wait: the app shows until when it's blocked. Retrying only extends the block. Prefer **Sync liked songs** over a full reanalysis. |
| 403 mentioning Premium | The app owner's Premium has expired. |
| Login loops back to the start | You opened `localhost`; use `http://127.0.0.1:3000`. |
| Still "missing variable" after editing `.env.local` | Restart the server. On Windows, check that no old process holds port 3000 (`netstat -ano \| findstr :3000`). |
| Page without styles or errors on `_next/static` | You ran `npm run build` while the server was running. Stop it and start again. |

The full list is on `/setup` (section "Common errors"), and error messages in the app link to it.

## Performance

| Measure | Result | How |
|---|---|---|
| Move one track (reducer) | 0.06 ms | 4,344 tracks, Node 24, Vitest script |
| Move 500 tracks at once | 0.38 ms | same |
| Include/exclude a genre | < 0.01 ms | same |
| Artist consensus + coherence check | 11.5 ms | 4,344 tracks; runs only when new tracks arrive, not on clicks |
| Track rows rendered per open group | 100 at a time | before: every row of every group (~127k DOM nodes) |
| `/me/playlists` listings | 1 per session | writes patch the cached list |
| **Sync liked songs** with nothing new | 1 request | a full re-read of 4,344 likes is 87 requests |

Target: every click under ~15 ms in the browser. Browser click latency was not re-measured for this release.

## Roadmap

- Import the Spotify data export (privacy download) to analyze without API calls.
- More genre families and tags.
- Detect unliked tracks in **Sync liked songs** without a full re-read.
- A clearer message when the local server is unreachable.

See [docs/good-first-issues.md](docs/good-first-issues.md).

## Contributing

Contributions are welcome, especially genre mappings. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).

## Credits

- Genre tags: [Last.fm](https://www.last.fm/api). Artist countries: [MusicBrainz](https://musicbrainz.org/) (open data, CC0). Library and playlists: [Spotify Web API](https://developer.spotify.com/documentation/web-api).
- Built with [Claude Code](https://claude.com/claude-code) as a pair-programming tool, then reviewed and tested by the author.

## License

[MIT](LICENSE) © 2026 Leonardo Abreu Ramos de Oliveira
