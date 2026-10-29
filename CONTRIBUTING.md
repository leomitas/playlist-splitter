# Contributing

Thanks for helping! Issues and pull requests are welcome in English or Portuguese.

## Running locally

```bash
npm install
npm run setup:env   # .env.local from .env.example, with AUTH_SECRET generated
npm run dev         # http://127.0.0.1:3000 (never localhost)
```

Follow `http://127.0.0.1:3000/setup` to create your own Spotify app and Last.fm key. `npm run doctor` checks the configuration.

Before opening a PR:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run typecheck` runs `next typegen` before `tsc --noEmit`, because Next's global types (`PageProps`, `LayoutProps`) are generated into `.next/types` and don't exist in a fresh clone.

`npm run format` (Prettier) is available; the existing code hasn't been reformatted in bulk yet, so format only the files you touch.

**Be careful with the Spotify quota.** Development Mode apps get blocked for hours when they make too many calls. Test with mocks (see `tests/`) instead of hammering the real API, and never test write flows (creating playlists, adding tracks) against a real account by accident.

## Folder structure

```
app/                     Next.js App Router (UI in English and pt-BR)
  page.tsx               login screen / main app
  spotify-app.tsx        main screen: playlist picker, analysis, preview
  analysis-queue.ts      background analysis and "Sync liked songs"
  preview.tsx            genre groups, quick review, export
  create-playlists.tsx   confirmation and creation of playlists
  setup/                 /setup guide and "Test configuration"
  actions.ts             server actions: one Spotify request each
  api/                   Auth.js route and Last.fm proxy
  i18n.tsx               useI18n(): t(), plurals, numbers and genre names
lib/                     logic without UI (most of it unit-tested)
  i18n/                  dictionaries: pt-BR.ts defines the keys, en.ts is typed against them
  genre-families.ts      Last.fm tag -> genre family map
  classify.ts            family choice per track, coherence check
  artist-consensus.ts    family by artist consensus
  musicbrainz.ts         artist country lookup (used only for the bare "funk" tag)
  dedupe.ts              duplicates by id and by artist + title
  preview-state.ts       reducer of the review screen
  request-queue.ts       queue, retries and quota block
  ...
scripts/                 setup:env and doctor
tests/                   Vitest
proxy.ts                 sends to /setup when variables are missing
auth.ts                  Auth.js config (scopes, token refresh)
```

Important decisions are documented in `CLAUDE.md` (for example why the auth route doesn't use next-auth's `handlers`).

## Adding a tag → genre family mapping

1. Check the tag on Last.fm (artist page > tags) and which artists carry it.
2. Add it in lowercase to the right family in [`lib/genre-families.ts`](lib/genre-families.ts). The file's header explains the rules: one family per tag, no mood/era tags.
3. New family? Add the key there and, optionally, a color in `app/genre-colors.ts`.
   - Funk is special: Brazilian funk tags belong to **Funk BR**, while the bare tag `funk` is never mapped (it's shared by funk carioca and American funk). Its family comes from the artist's country, looked up on MusicBrainz (Brazil → Funk BR, elsewhere → **Funk Internacional**, unknown → Funk (incerto)) (`lib/musicbrainz.ts`, `lib/country.ts`; 1 request per second, cached). Add Brazilian variations to Funk BR; don't map `funk` itself.
4. Run `npm test`: `tests/classify.test.ts` checks that every tag is lowercase and in a single family. Add a case if your mapping fixes a real misclassification.
5. In the PR, list a few example artists and where they ended up before ("Other") and after.

## Commits and pull requests

- Commit messages in English, short and imperative: `Add phonk tags`, `Fix liked songs sync after unlike`.
- One topic per PR; describe what and why, and how you tested. Fill in the PR checklist.
- The UI is in English and Portuguese (pt-BR). Visible text never goes straight into `app/`: add a key to `lib/i18n/pt-BR.ts` and its translation to `lib/i18n/en.ts`, then use `t()` from `useI18n()`. `tests/no-hardcoded-text.test.ts` fails on hardcoded text.
- Code, comments and commits in English.
- Never commit `.env.local`, tokens or screenshots showing them.
- Keep clicks instant: heavy work goes off the click path (`useDeferredValue`, memoized rows, lists rendered on demand).

By contributing you agree that your contributions are licensed under the MIT License.
