# Playlist Splitter

**English** · [Português (Brasil)](README.pt-BR.md)

Split the songs of your Spotify playlists (and liked songs) by genre and create one playlist per genre. You review everything first; nothing changes on Spotify until you confirm.

> Independent project, not affiliated with or endorsed by Spotify or Last.fm.

<!-- GIF: analysis → genre spectrum → create playlists. Save as docs/media/demo.gif and use: ![Demo](docs/media/demo.gif) -->
**Demo GIF:** coming soon.

<!-- Video: 2-minute walkthrough of setup and first run. Replace with the link. -->
**Video:** walkthrough coming soon.

## Features

- **Genre spectrum** of the selected playlists and liked songs, grouped into families (Rock, MPB, Funk BR, Hip-hop/Rap, Eletrônica…).
- **Review before creating:** rename, merge and include/exclude groups; search, filter and move tracks in bulk; a single list of every low-confidence track; export the classification as JSON.
- **Brazilian vs. American funk:** Brazilian funk tags go to **Funk BR**; for artists tagged only "funk", the artist's country (MusicBrainz) decides between **Funk BR** and **Funk Internacional**, and unknown ones wait in **Funk (incerto)** for review.
- **Duplicates removed** by Spotify id and by identical artist + title (versions such as Remix, Slowed or Ao Vivo stay).
- **Artist consensus:** when an artist's confident tracks agree on a family, their unclassified or low-confidence tracks follow (never overriding confident tracks or your manual moves).
- **Quota-friendly:** everything read is cached in the browser (IndexedDB); "Sincronizar curtidas" reads only new likes; existing app playlists are updated instead of duplicated and only re-read when their snapshot changed.
- **Blocks handled:** when Spotify blocks the app (429 with a long Retry-After), it stops calling, shows until when, and survives reloads.
- **Background analysis** with pause/resume, per-playlist progress and retries.
- **In-app setup guide** at `/setup`, plus `npm run setup:env` and `npm run doctor`.

## Stack

Next.js 16 (App Router, Turbopack, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 · Auth.js (`next-auth@5` + `@auth/core`) · Spotify Web API, Last.fm API and MusicBrainz API via `fetch` · Vitest. No database: session in an encrypted cookie, data in the browser.

## Why genres come from Last.fm

Spotify removed the `genres` field and the batch endpoints (e.g. several artists per request) for apps in **Development Mode**, which is the mode every self-hosted copy of this app runs in. Genres therefore come from **Last.fm tags** of the artist (and of the track, when the artist's tags aren't enough), mapped to families by a simple whitelist in [`lib/genre-families.ts`](lib/genre-families.ts).

The bare tag **"funk"** is ambiguous (funk carioca and American funk share it), so for artists with no Brazilian funk tag the app asks **MusicBrainz** for the artist's country: Brazil → Funk BR, another country → Funk Internacional (still competing with the other tags: R&B/Soul when soul/R&B weighs more, Jazz when jazz does), not found → Funk (incerto). A country is used only for a confident, exact match (score ≥ 90, same normalized name or alias). MusicBrainz allows **1 request per second**, so these lookups run in the background at that pace (with pause and time left) and are cached in the browser; "not found" is asked again after 14 days.

## Spotify limits you should know

- **Development Mode:** each person who runs the app creates their own Spotify app in the Dashboard.
- **Up to 5 users** per app, each registered by e-mail in *User Management* (otherwise every call returns 403).
- **The app owner needs Spotify Premium.**
- **Quota:** Spotify limits how many calls an app makes; going over can block it for hours (`429`, `QUOTA_EXCEEDED`). The app queues calls one at a time, caches everything and stops on a block instead of retrying.

## Quick start

Requirements: Node.js 20+ and a Spotify Premium account.

```bash
npm install
npm run setup:env   # creates .env.local (never overwrites) and generates AUTH_SECRET
npm run dev
```

Open **http://127.0.0.1:3000/setup** (always `127.0.0.1`, never `localhost`) and follow the six steps: create the Spotify app, register your e-mail, get a Last.fm key, fill `.env.local`, restart. Then `npm run doctor` checks the configuration without printing any value.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `INVALID_CLIENT: Invalid redirect URI` | Register exactly `http://127.0.0.1:3000/api/auth/callback/spotify` in the Dashboard and set `AUTH_URL=http://127.0.0.1:3000`. |
| 403 after login, "user may not be registered" | Add your Spotify e-mail in Dashboard > User Management, then log out and in. |
| 429 / `QUOTA_EXCEEDED` | Wait: the app shows until when it's blocked. Retrying only extends the block. |
| 403 mentioning Premium | The app owner's Premium has expired. |
| Login loops back to the start | You opened `localhost`; use `http://127.0.0.1:3000`. |
| Still "missing variable" after editing `.env.local` | Restart `npm run dev`. On Windows, check that no old process holds port 3000 (`netstat -ano \| findstr :3000`). |

The full list is on `/setup` (section "Erros comuns"), and error messages in the app link to it.

## Performance

| Measure | Result | How |
|---|---|---|
| Move one track (reducer) | 0.06 ms | 4,344 tracks, Node 24, Vitest script |
| Move 500 tracks at once | 0.38 ms | same |
| Include/exclude a genre | < 0.01 ms | same |
| Artist consensus + coherence check | 11.5 ms | 4,344 tracks; runs only when new tracks arrive, not on clicks |
| Track rows rendered per open group | 100 at a time | before: every row of every group (~127k DOM nodes) |
| `/me/playlists` listings | 1 per session | writes patch the cached list |
| "Sincronizar curtidas" with nothing new | 1 request | a full re-read of 4,344 likes is 87 requests |

Target: every click under ~15 ms in the browser. Browser click latency was not re-measured for this release.

## Roadmap

- Import the Spotify data export (privacy download) to analyze without API calls.
- More genre families and tags.
- Detect unliked tracks in "Sincronizar curtidas" without a full re-read.

See [docs/good-first-issues.md](docs/good-first-issues.md).

## Contributing

Contributions are welcome, especially genre mappings. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Leonardo Abreu Ramos de Oliveira
