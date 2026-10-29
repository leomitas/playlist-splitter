# Security Policy

## Supported versions

Only the latest commit on `main` is supported.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub: **Security > Report a vulnerability** on this repository ([direct link](https://github.com/leomitas/playlist-splitter/security/advisories/new)).

Include what's affected, how to reproduce it and the impact. You can expect a first answer within 7 days.

## Scope and design notes

- The app runs locally (`http://127.0.0.1:3000`) with each user's own Spotify app. There is no shared server and no database.
- The Spotify access token stays on the server side (encrypted session cookie); the browser calls server actions, never the Spotify API with the token.
- Secrets live only in `.env.local`, which is git-ignored. `npm run doctor`, `npm run setup:env` and "Testar configuração" never print, log or return values.
- Cached tracks and tags are stored in the browser's IndexedDB; "Limpar cache" removes them.

If you find a secret committed by mistake in this repository's history, report it privately as above.
