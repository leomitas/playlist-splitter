# Spotify Playlist Sorter

## Objetivo

Separar as músicas das playlists do Spotify por gênero e criar playlists novas a partir disso.

## Stack

- Next.js 16 (App Router, Turbopack, `cacheComponents` ligado), React 19, TypeScript
- Tailwind CSS 4
- Auth.js: `next-auth@5` beta + `@auth/core` (versão fixa, igual à que o next-auth usa)
- Spotify Web API, chamada direto com `fetch` (sem SDK)

## Como rodar

1. Copie `.env.example` para `.env.local` e preencha os valores (o `AUTH_SPOTIFY_SECRET` vem do Spotify Dashboard).
2. `npm install`
3. `npm run dev` e abra **http://127.0.0.1:3000**.
   - Use `127.0.0.1`, nunca `localhost`: o Spotify não aceita `localhost` como redirect URI, e o cookie de sessão fica preso à origem.
   - O script já roda `next dev -H 127.0.0.1 -p 3000`.
   - Redirect URI cadastrada no Spotify Dashboard: `http://127.0.0.1:3000/api/auth/callback/spotify`
4. Verificação: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

No Windows, parar o dev server pode deixar um processo `next` ocupando a porta 3000 com o `.env.local` antigo. Confira com `netstat -ano | grep :3000` e mate o processo com `taskkill //PID <pid> //T //F`.

## Estrutura

```
auth.ts                              config do Auth.js: provider, scopes, refresh de token
app/api/auth/[...nextauth]/route.ts  rota do Auth.js (GET/POST)
app/page.tsx                         login, perfil (/v1/me), 5 playlists (/v1/me/playlists), logout
next.config.ts                       imagens remotas do Spotify (*.scdn.co, *.spotifycdn.com)
.env.example                         chaves de ambiente (sem valores)
```

## Decisões de autenticação

- **Sessão:** JWT, sem banco. O JWT guarda `access_token`, `refresh_token` e `expires_at`.
  - A sessão expõe `accessToken` e `error`.
- **Refresh:** automático no callback `jwt`, com margem de 60s antes de expirar.
  - Se o refresh falhar, `session.error = "RefreshTokenError"` e a UI pede login de novo.
- **Scopes:** `user-read-email playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private`.
- **`route.ts` não usa `handlers` do next-auth.**
  - Motivo: o `NextRequest` reescreve `127.0.0.1` para `localhost`, e isso quebraria a redirect URI.
  - Solução: a rota monta um `Request` comum sobre `AUTH_URL` e chama o `Auth` do `@auth/core`.
  - Não troque de volta para `handlers`. Não crie rota de callback customizada.
- **Erros do Auth.js:** `pages.signIn` e `pages.error` apontam para `/`, e o erro chega como `?error=...`.
- **Logs:** a ação de login registra no terminal a `redirect_uri` enviada ao Spotify (útil para "Invalid redirect URI").
- **Development Mode:** com o app nesse modo no Spotify, o `email` do `/v1/me` pode vir vazio. A UI trata esse caso.

## Status

- **Etapa 1 — pronta:** login com Spotify, perfil (nome, foto, e-mail) e as 5 primeiras playlists, logout, erros visíveis na tela.
- **Próximas:** ler as faixas, classificar por gênero, criar playlists novas. Nada disso foi implementado.

## Convenções

- Código e commits em inglês; conversa em pt-BR.
- Não commitar `.env.local`.
- Com `cacheComponents`, código que lê sessão ou cookies fica dentro de `<Suspense>` e chama `await connection()` antes.
