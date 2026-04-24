# Desenvolvimento

Como rodar `@datasus-brasil/site` localmente, variáveis de ambiente e
_workflow_ com _worktrees_.

## Pré-requisitos

- Node.js 22
- pnpm (via `corepack enable`)
- Para regenerar _tiles_: `brew install tippecanoe pmtiles`
- Para publicar: AWS CLI configurado (`sa-east-1`)

## _Setup_

```bash
pnpm install
```

Do repo _root_; workspaces resolvem `@datasus-brasil/site` automaticamente.

## Variáveis de ambiente

Criar `packages/site/.env.local`:

```ini
# Recomendado — sem o token, o mapa cai em modo texto (fail graceful)
VITE_MAPBOX_TOKEN=pk.seu_token_aqui

# Opcional — sobrescreve o base URL do CloudFront
# Útil para QA contra outro bucket ou dev offline (ver abaixo)
# VITE_DATA_BASE_URL=/data-local
```

_Token_ Mapbox gratuito: [`account.mapbox.com`](https://account.mapbox.com/).

### Dev _offline_ / sem CloudFront

Para iterar sem depender de rede, copiar `build/parquet-opt`,
`build/geo` e `build/manifest` para `packages/site/public/data-local/`
e apontar:

```ini
VITE_DATA_BASE_URL=/data-local
```

Vite serve `public/` na raiz do servidor.

## _Scripts_ de desenvolvimento

```bash
pnpm -F @datasus-brasil/site dev          # Vite em :4322 (main worktree)
pnpm -F @datasus-brasil/site build        # tsc + vite build
pnpm -F @datasus-brasil/site preview      # serve dist/
pnpm -F @datasus-brasil/site lint
pnpm -F @datasus-brasil/site typecheck
pnpm -F @datasus-brasil/site test
pnpm -F @datasus-brasil/site test:coverage
```

Do repo _root_, via Turborepo:

```bash
pnpm turbo run lint typecheck
pnpm turbo run test
```

## _Scripts_ de pipeline de dados

Ver [`data-pipeline.md`](./data-pipeline.md) para cada _script_ em
detalhe.

```bash
pnpm -F @datasus-brasil/site aggregate --ufs AC --years 2024
pnpm -F @datasus-brasil/site build:consolidate
pnpm -F @datasus-brasil/site build:parquet-index
pnpm -F @datasus-brasil/site build:geo-tiles
pnpm -F @datasus-brasil/site upload:aws
```

## _Worktrees_

Regra do repo (ver `AGENTS.md`): sessões paralelas **sempre** num
_worktree_ dedicado. O _worktree-cli_ gerencia alocação de portas.

### Portas alocadas

| _Worktree_ | Porta do site              |
| ---------- | -------------------------- |
| `main`     | `4322`                     |
| _feature_  | `4332`+ (incremento de 10) |

Registro: `/tmp/datasus-brasil-worktree-ports.json`.

### Comandos

```bash
pnpm exec precisa-worktree list                       # todos os worktrees + portas
pnpm exec precisa-worktree setup feat/meu-branch      # cria + install + aloca
pnpm exec precisa-worktree dev --detach               # sobe dev server em background
pnpm exec precisa-worktree stop                       # mata dev deste worktree
pnpm exec precisa-worktree teardown feat/meu-branch   # cleanup pós-merge
```

De sessões de agente, **sempre** usar `dev --detach` — `dev` no
_foreground_ é morto quando a _tool call_ expira.

### Verificar que subiu

```bash
sleep 5 && curl -sI http://localhost:4332 | head -1
```

## _Layout_ do pacote

```
packages/site/
├── docs/                   ← esta documentação
├── public/                 ← estáticos servidos em /
├── scripts/                ← pipeline de dados (Node/Bash)
├── src/
│   ├── components/         ← React components (UI)
│   ├── lib/                ← DuckDB, Mapbox, PMTiles, queries, types
│   ├── pages/              ← /, /sobre
│   ├── App.tsx             ← router
│   ├── main.tsx            ← entrypoint
│   └── index.css           ← Tailwind + themes
├── test/                   ← Vitest (jsdom)
│   ├── components/
│   ├── lib/
│   └── setup.ts
├── build/                  ← output dos scripts de dados (gitignored)
├── dist/                   ← output do vite build (gitignored)
├── coverage/               ← output do vitest --coverage (gitignored)
├── index.html
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
└── README.md
```

## Testes

```bash
pnpm -F @datasus-brasil/site test
pnpm -F @datasus-brasil/site test:coverage
```

Ambiente: `jsdom`, Vitest + `@testing-library/react`.
_Threshold_ de cobertura: 80 % em _branches_, _functions_, _lines_,
_statements_ (herdado do baseline da monorepo).

Excluídos (`vitest.config.ts`):

- `scripts/**` — ferramentas de _build_, validadas manualmente
- `src/pages/**` — composição; lógica real está em `src/lib/`
- Componentes de mapa (`BrasilMap`, `MapView*`) — mockar WebGL em
  jsdom vira "teste do _mock_"; validação é _golden path_ manual
- `App.tsx`, `main.tsx`, `Nav.tsx`, `Footer.tsx` — _layout_/routing

Antes de subir cobertura: revisar a lista de exclusões acima antes de
adicionar testes a arquivos que intencionalmente estão de fora.

## _Convention_ de saída de dados

Regra específica do repo (`AGENTS.md`): saída visível ao usuário
(exemplos, CLI, _snippets_ do README) é **JSON** por padrão, **JSONL**
para _streaming_. CSV só como opt-in (`--format csv`). Parquet/Arrow
são camadas de _storage/cache_, não saída primária.

No contexto deste pacote: o pipeline _interno_ é Parquet (eficiência
de Range Requests), mas o manifesto consumido pelo _boot_ e exemplos
de saída em CLI são JSON.

## Ver também

- [`architecture.md`](./architecture.md)
- [`data-pipeline.md`](./data-pipeline.md)
- [`deployment.md`](./deployment.md)
