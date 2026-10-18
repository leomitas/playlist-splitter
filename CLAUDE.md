# Spotify Playlist Sorter (Playlist Splitter)

## Objetivo

Separar as músicas das playlists do Spotify (e das curtidas) por gênero e criar playlists novas a partir disso. Versão local, open source (MIT): cada pessoa roda com o próprio app do Spotify.

## Stack

- Next.js 16 (App Router, Turbopack, `cacheComponents` ligado), React 19, TypeScript
- Tailwind CSS 4
- Auth.js: `next-auth@5` beta + `@auth/core` (versão fixa, igual à que o next-auth usa)
- Spotify Web API, Last.fm API e MusicBrainz API, chamadas direto com `fetch` (sem SDK)
- Vitest (testes em `tests/`), Prettier (config pronta; o código antigo ainda não foi reformatado)

## Como rodar

1. `npm install` e `npm run setup:env` (cria `.env.local` a partir do `.env.example` sem sobrescrever e gera o `AUTH_SECRET`).
2. `npm run dev` e abra **http://127.0.0.1:3000/setup** para o passo a passo (Dashboard, User Management, Last.fm, variáveis).
   - Use `127.0.0.1`, nunca `localhost`: o Spotify não aceita `localhost` como redirect URI, e o cookie de sessão fica preso à origem.
   - O script já roda `next dev -H 127.0.0.1 -p 3000`.
   - Redirect URI cadastrada no Spotify Dashboard: `http://127.0.0.1:3000/api/auth/callback/spotify`
3. `npm run doctor` confere o `.env.local` sem imprimir valores.
4. Verificação: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (o build não precisa de variáveis; o CI roda os quatro).
   - `typecheck` = `next typegen && tsc --noEmit`: `PageProps`/`LayoutProps` vêm de `.next/types`, que não existe num clone limpo. Não troque por `tsc` puro.

Variáveis: `AUTH_SPOTIFY_ID`, `AUTH_SPOTIFY_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `LASTFM_API_KEY`. Faltando qualquer uma, o `proxy.ts` manda as páginas para `/setup` e as rotas de API respondem 503.

No Windows, parar o dev server pode deixar um processo `next` ocupando a porta 3000 com o `.env.local` antigo. Confira com `netstat -ano | grep :3000` e mate o processo com `taskkill //PID <pid> //T //F`.

## Estrutura

```
auth.ts                      config do Auth.js: provider, scopes, refresh de token
proxy.ts                     (middleware do Next 16) variável faltando -> /setup
app/api/auth/[...nextauth]/  rota do Auth.js (GET/POST) sobre @auth/core
app/api/lastfm/route.ts      proxy das tags do Last.fm (Route Handler para ter concorrência)
app/api/musicbrainz/route.ts país do artista no MusicBrainz (sessão, User-Agent, 1 req/s)
app/country-lookup.ts        fila em segundo plano das consultas de país (pausável, cache IndexedDB)
app/actions.ts               server actions: uma requisição ao Spotify cada
app/page.tsx                 login / app
app/spotify-app.tsx          tela principal: playlists, análise, prévia, faixa de bloqueio
app/analysis-queue.ts        análise em segundo plano, "Sincronizar curtidas", reanálise completa
app/spotify-data.ts          leitores com cache (lista da sessão, faixas por snapshot, playlists criadas)
app/preview.tsx              grupos, revisão rápida (busca, filtros, lote), export JSON
app/create-playlists.tsx     confirmação e criação/atualização de playlists
app/setup/                   guia /setup e "Testar configuração" (server action, só fora de produção)
lib/genre-families.ts        mapa tag do Last.fm -> família
lib/classify.ts              família por faixa, checagem de coerência
lib/artist-consensus.ts      consenso por artista
lib/musicbrainz.ts           busca e regra de casamento (score >= 90, nome/alias exato)
lib/country.ts               aplica o país às faixas com a tag genérica "funk"
lib/dedupe.ts                duplicatas por ID e por artista + título idênticos
lib/preview-state.ts         reducer da prévia (movimentos manuais, sync com o consenso)
lib/request-queue.ts         fila, retries e bloqueio por cota (lib/quota-block.ts)
lib/known-errors.ts          mapa de erros comuns (usado no /setup e nas mensagens)
scripts/                     setup-env.mjs, doctor.mjs
```

## Decisões importantes

### Autenticação

- **Sessão:** JWT, sem banco. O JWT guarda `access_token`, `refresh_token` e `expires_at`; a sessão expõe `accessToken` e `error`.
- **Refresh:** automático no callback `jwt`, com margem de 60s. Se falhar, `session.error = "RefreshTokenError"` e a UI pede login de novo.
- **Scopes:** `user-read-email playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-library-read`.
- **`route.ts` não usa `handlers` do next-auth.** O `NextRequest` reescreve `127.0.0.1` para `localhost`, o que quebraria a redirect URI; a rota monta um `Request` comum sobre `AUTH_URL` e chama o `Auth` do `@auth/core`. Não troque de volta para `handlers`. Não crie rota de callback customizada.
- Pelo mesmo motivo, o redirect do `proxy.ts` usa o cabeçalho `Host`, não `req.nextUrl`.
- **Erros do Auth.js:** `pages.signIn` e `pages.error` apontam para `/`; o erro chega como `?error=...` e é mapeado em `lib/known-errors.ts`.
- **Logs:** a ação de login registra no terminal a `redirect_uri` enviada ao Spotify.

### Limites do Spotify (Development Mode)

- Até 5 usuários, cadastrados em User Management (senão, 403); o dono do app precisa de Premium.
- O campo `genres` e os endpoints em lote não estão disponíveis: **os gêneros vêm das tags do Last.fm** (artista; faixa só quando o artista não dá família).
- Endpoints usados (Spotify): `/v1/me`, `/v1/me/playlists` (listar e criar), `/v1/playlists/{id}/items` (ler e adicionar; a API de fev/2026 renomeou `tracks` para `items` e `track` para `item`, o código aceita os dois), `/v1/me/tracks` (curtidas, só leitura).
- O `email` do `/v1/me` pode vir vazio; a UI trata.
- **Cota:** o app já foi bloqueado com 429 `QUOTA_EXCEEDED`. Toda chamada passa pela fila (`lib/spotify-client.ts`, uma por vez, 200 ms). 429 com `Retry-After` > 120 s = bloqueio: nada é tentado até o fim, o horário fica no `localStorage` e os botões que chamam o Spotify ficam desabilitados. Retry-After curto continua como pausa automática.
- Economia: uma listagem de `/me/playlists` por sessão (as escritas atualizam a lista em cache); faixas em IndexedDB por `snapshot_id`; playlists criadas pelo app em IndexedDB (`created:<id>`, com URIs e snapshot); "Sincronizar curtidas" lê páginas de 50 até achar uma URI conhecida.
- **Nunca** faça chamadas reais de escrita ao Spotify em testes; use mocks (`tests/`).

### Classificação

- Pipeline na tela (useMemo em `spotify-app.tsx`): país do artista → coerência → consenso. `baseFamily` guarda a família só das tags; a prévia reposiciona faixas cuja família mudou (país ou consenso), nunca as movidas à mão.
- **Funk:** tags brasileiras → "Funk BR". A tag genérica `funk` não tem família: com tag brasileira soma em Funk BR; sem ela, o país (MusicBrainz) decide: BR → Funk BR, outro → R&B/Soul (competindo com as outras tags, então jazz pesado vai para Jazz), desconhecido → "Funk (incerto)". "Funk (incerto)" e "Outros" não votam no consenso e podem receber família dele.
- **MusicBrainz:** só para artistas com `funk` genérico e sem tag brasileira. País só com score >= 90 e nome ou alias idêntico após normalizar (normalização que preserva qualquer escrita; a `normalizeName` antiga zera nomes em japonês). Máx. 1 req/s (fila no navegador a 1,1 s + espaçamento no servidor). Cache `mb:<nome>` no IndexedDB; "não achei" expira em 14 dias.
- **Coerência ("tags fora do padrão da seleção"):** uma palavra de tag é aceita se estiver no top 15 dos outros artistas **ou** for usada por >= 3 outros artistas (antes, gêneros minoritários inteiros, como funk, eram marcados).
- `CLASSIFIER_VERSION` (hoje 2) fica na análise salva; análises antigas mostram aviso para analisar de novo.
- Duplicatas: mesmo ID do Spotify ou mesmo primeiro artista + título normalizados (Remix, Slowed, Ao Vivo continuam distintos).
- Consenso por artista: votos só de faixas confiáveis (com família e sem baixa confiança); família com >= 2 votos e >= 65% vai para as faixas do artista sem família ou de baixa confiança. Nunca muda faixa confiável. Faixas movidas à mão (`PreviewState.manual`) nunca são reposicionadas.
- Agrupamento por ID do artista; caches antigos sem ID usam o nome normalizado (homônimos com IDs diferentes não emprestam ID).

## Status

- **Pronto:** login; análise de playlists e curtidas em segundo plano com cache; classificação por gênero (Last.fm + consenso por artista); prévia com revisão rápida e export JSON; criação/atualização de playlists com progresso; bloqueio por cota; sincronização incremental das curtidas; `/setup`, `setup:env`, `doctor`; estrutura open source (README en/pt-BR, CONTRIBUTING, CoC, SECURITY, templates, CI, Dependabot).
- **Falta / próximos:** gravar GIF e vídeos (placeholders no README e em `app/setup/videos.ts`); reformatar o código com Prettier num commit único e ligar `format:check` no CI; detectar descurtidas sem reanálise completa; tradução da interface; tema claro; importar o arquivo de dados do Spotify (ver `docs/good-first-issues.md`).
- **Sem teste com a API real:** criação/atualização de playlists com o cache de criadas, sincronização de curtidas, bloqueio por 429 real, "Testar configuração" contra Spotify/Last.fm, consultas reais ao MusicBrainz, latência de clique no navegador.

## Convenções

- Código e commits em inglês; conversa e UI em pt-BR.
- Não commitar `.env.local`.
- Com `cacheComponents`, código que lê sessão, cookies ou variáveis de ambiente fica dentro de `<Suspense>` e chama `await connection()` antes.
- Cliques abaixo de ~15 ms: trabalho pesado fora do caminho do clique (`useDeferredValue`, linhas memoizadas, listas renderizadas sob demanda).
