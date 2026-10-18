## What and why

<!-- What changes, and the problem it solves. Link the issue: Closes #123 -->

## How I tested

<!-- Tests added/updated, and what you checked by hand in the app. -->

## Checklist

- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run build` pass
- [ ] No secrets, tokens or `.env.local` values in code, commits, screenshots or logs
- [ ] No new Spotify calls, or they go through the queue and cache (`lib/spotify-client.ts`) and I explain the quota impact
- [ ] Nothing writes to Spotify without the user's explicit confirmation
- [ ] Clicks stay instant (no work over ~15 ms on the click path; heavy lists render on demand)
- [ ] UI text in Portuguese (pt-BR), code and commits in English
- [ ] Genre mappings: tags lowercase, in a single family, with an example in the PR description
