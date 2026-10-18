# Playlist Splitter

[English](README.md) · **Português (Brasil)**

Separa as músicas das suas playlists do Spotify (e das curtidas) por gênero e cria uma playlist para cada gênero. Você revisa tudo antes; nada muda no Spotify sem a sua confirmação.

> Projeto independente, não afiliado nem endossado pelo Spotify ou pelo Last.fm.

<!-- GIF: análise → espectro de gêneros → criar playlists. Salve em docs/media/demo.gif e use: ![Demonstração](docs/media/demo.gif) -->
**GIF de demonstração:** em breve.

<!-- Vídeo: 2 minutos mostrando a configuração e o primeiro uso. Troque pelo link. -->
**Vídeo:** passo a passo em breve.

## Recursos

- **Espectro de gêneros** das playlists escolhidas e das curtidas, agrupado em famílias (Rock, MPB, Funk BR, Hip-hop/Rap, Eletrônica…).
- **Revisão antes de criar:** renomear, juntar e marcar/desmarcar grupos; buscar, filtrar e mover faixas em lote; lista única de todas as faixas de baixa confiança; exportar a classificação em JSON.
- **Funk brasileiro x funk gringo:** tags de funk brasileiro vão para **Funk BR**; para artistas só com a tag "funk", o país do artista (MusicBrainz) decide entre **Funk BR** e **Funk Internacional**, e os de país desconhecido ficam em **Funk (incerto)** para revisão.
- **Duplicatas removidas** por ID do Spotify e por artista + título idênticos (versões como Remix, Slowed ou Ao Vivo continuam).
- **Consenso por artista:** quando as faixas confiáveis de um artista concordam numa família, as faixas dele sem família ou de baixa confiança vão junto (sem sobrescrever faixas confiáveis nem o que você moveu à mão).
- **Econômico com a cota:** tudo que é lido fica em cache no navegador (IndexedDB); "Sincronizar curtidas" lê só as curtidas novas; playlists já criadas pelo app são atualizadas em vez de duplicadas e só são relidas quando o snapshot mudou.
- **Bloqueio tratado:** quando o Spotify bloqueia o app (429 com Retry-After longo), ele para de chamar, mostra até quando e lembra disso ao recarregar.
- **Análise em segundo plano** com pausar/retomar, progresso por playlist e novas tentativas.
- **Guia de configuração no app** em `/setup`, além de `npm run setup:env` e `npm run doctor`.

## Stack

Next.js 16 (App Router, Turbopack, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 · Auth.js (`next-auth@5` + `@auth/core`) · Spotify Web API, Last.fm API e MusicBrainz API via `fetch` · Vitest. Sem banco de dados: sessão em cookie criptografado, dados no navegador.

## Por que os gêneros vêm do Last.fm

O Spotify removeu o campo `genres` e os endpoints em lote (vários artistas por requisição) para apps em **Development Mode**, que é o modo de toda cópia deste app rodando localmente. Por isso os gêneros vêm das **tags do Last.fm** do artista (e da faixa, quando as do artista não bastam), mapeadas para famílias por uma lista simples em [`lib/genre-families.ts`](lib/genre-families.ts).

A tag genérica **"funk"** é ambígua (funk carioca e funk americano usam a mesma), então, para artistas sem tag de funk brasileiro, o app pergunta ao **MusicBrainz** o país do artista: Brasil → Funk BR, outro país → Funk Internacional (ainda competindo com as outras tags: R&B/Soul quando soul/R&B pesa mais, Jazz quando o jazz pesa), não encontrado → Funk (incerto). O país só vale num resultado confiável e exato (score ≥ 90, mesmo nome ou alias normalizado). O MusicBrainz permite **1 requisição por segundo**, então essas consultas rodam em segundo plano nesse ritmo (com pausa e tempo restante) e ficam em cache no navegador; "não encontrado" é consultado de novo depois de 14 dias.

## Limites do Spotify

- **Development Mode:** cada pessoa que roda o app cria o próprio app no Dashboard do Spotify.
- **Até 5 usuários** por app, cada um cadastrado por e-mail em *User Management* (sem isso, toda chamada dá 403).
- **O dono do app precisa de Spotify Premium.**
- **Cota:** o Spotify limita quantas chamadas um app faz; passar do limite pode bloqueá-lo por horas (`429`, `QUOTA_EXCEEDED`). O app enfileira as chamadas uma a uma, guarda tudo em cache e para quando é bloqueado em vez de insistir.

## Início rápido

Requisitos: Node.js 20+ e uma conta Spotify Premium.

```bash
npm install
npm run setup:env   # cria o .env.local (nunca sobrescreve) e gera o AUTH_SECRET
npm run dev
```

Abra **http://127.0.0.1:3000/setup** (sempre `127.0.0.1`, nunca `localhost`) e siga os seis passos: criar o app no Spotify, cadastrar seu e-mail, pegar a chave do Last.fm, preencher o `.env.local` e reiniciar. Depois, `npm run doctor` confere a configuração sem mostrar nenhum valor.

## Solução de problemas

| Sintoma | Solução |
|---|---|
| `INVALID_CLIENT: Invalid redirect URI` | Cadastre exatamente `http://127.0.0.1:3000/api/auth/callback/spotify` no Dashboard e use `AUTH_URL=http://127.0.0.1:3000`. |
| 403 depois do login, "user may not be registered" | Adicione seu e-mail do Spotify em Dashboard > User Management, saia e entre de novo. |
| 429 / `QUOTA_EXCEEDED` | Espere: o app mostra até quando está bloqueado. Tentar de novo só prolonga o bloqueio. |
| 403 citando Premium | O Premium do dono do app venceu. |
| O login volta para a tela inicial | Você abriu por `localhost`; use `http://127.0.0.1:3000`. |
| Continua "faltando variável" depois de editar o `.env.local` | Reinicie o `npm run dev`. No Windows, confira se nenhum processo antigo ficou na porta 3000 (`netstat -ano \| findstr :3000`). |

A lista completa está em `/setup` (seção "Erros comuns"), e as mensagens de erro do app apontam para ela.

## Desempenho

| Medida | Resultado | Como |
|---|---|---|
| Mover uma faixa (reducer) | 0,06 ms | 4.344 faixas, Node 24, script Vitest |
| Mover 500 faixas de uma vez | 0,38 ms | idem |
| Marcar/desmarcar um gênero | < 0,01 ms | idem |
| Consenso por artista + coerência | 11,5 ms | 4.344 faixas; roda só quando chegam faixas novas, não em cliques |
| Linhas de faixa por grupo aberto | 100 por vez | antes: todas as linhas de todos os grupos (~127 mil nós no DOM) |
| Listagens de `/me/playlists` | 1 por sessão | as escritas atualizam a lista em cache |
| "Sincronizar curtidas" sem novidade | 1 requisição | reler 4.344 curtidas são 87 requisições |

Meta: todo clique abaixo de ~15 ms no navegador. A latência de clique no navegador não foi medida de novo nesta versão.

## Roadmap

- Importar o arquivo de dados do Spotify (download de privacidade) para analisar sem chamadas à API.
- Tradução da interface (inglês).
- Tema claro.
- Mais famílias e tags de gênero.
- Detectar descurtidas em "Sincronizar curtidas" sem releitura completa.

Veja [docs/good-first-issues.md](docs/good-first-issues.md).

## Como contribuir

Contribuições são bem-vindas, principalmente mapeamentos de gênero. Leia o [CONTRIBUTING.md](CONTRIBUTING.md) e o [Código de Conduta](CODE_OF_CONDUCT.md). Problemas de segurança: [SECURITY.md](SECURITY.md).

## Licença

[MIT](LICENSE) © 2026 Leonardo Abreu Ramos de Oliveira
