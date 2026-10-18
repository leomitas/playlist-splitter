# Good first issues

Small, well-scoped tasks for a first contribution. Open an issue saying which one you're taking.

## 1. New genre families and tags

Many tracks still land in "Outros" because their Last.fm tags aren't mapped.

- Where: `lib/genre-families.ts` (rules in the file header), optional color in `app/genre-colors.ts`.
- Ideas: Reggae/Dub, K-pop as its own family, Gospel split from R&B/Soul, Forró split from Sertanejo, Latin (cumbia, bachata, salsa), Classical.
- Done when: `npm test` passes and the PR lists example artists before/after.

## 2. Interface translation

The UI is in Portuguese. Add English as a second language.

- Start by moving the strings of one screen (e.g. `app/setup/page.tsx`) to a dictionary file; pick the language from `navigator.language` with a manual switch.
- Keep it dependency-free if possible; discuss in the issue before adding an i18n library.

## 3. Light theme

Colors are tokens in `app/globals.css` (`@theme`: `cafe`, `grafite`, `papel`, `areia`…), and genre colors in `app/genre-colors.ts` use a fixed OKLCH lightness tuned for dark surfaces.

- Add a light palette under `@media (prefers-color-scheme: light)` (and a toggle, optionally).
- Check that genre colors keep enough contrast on light backgrounds (adjust the lightness per theme).

## 4. Import the Spotify data export

Spotify's privacy download ("Download your data") includes the library as JSON. Reading it would allow analyzing liked songs and playlists **without any API call**, which saves the quota.

- Add an "Importar arquivo" option that reads `YourLibrary.json` / `Playlist1.json` in the browser.
- Map the entries to the `PlaylistTrack` shape (`lib/spotify.ts`) and feed them to the analysis queue.
- Note: the export has track/artist names and URIs, not artist IDs; the artist consensus falls back to names.
