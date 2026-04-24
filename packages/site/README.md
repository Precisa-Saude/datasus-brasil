# @datasus-brasil/site

Visualização geográfica interativa de biomarcadores e exames
laboratoriais faturados ao SUS — SIA-PA (Produção Ambulatorial)
filtrado para SIGTAP `02.02` (laboratório clínico) e cruzado com o
catálogo LOINC.

## Stack

Vite + React 19 + Tailwind v4 + shadcn + `@precisa-saude/ui`/`themes`

- MapLibre GL JS + PMTiles + DuckDB WASM. Mesma base das interfaces
  de `fhir-brasil/site` e `medbench-brasil/site`.

## Documentação

Guias detalhados em [`docs/`](./docs):

- [`architecture.md`](./docs/architecture.md) — fluxo de dados ponta a
  ponta, _runtime_ do browser, decisões de projeto.
- [`data-pipeline.md`](./docs/data-pipeline.md) — cada _script_ em
  detalhe (_flags_, entrada, saída, _schema_).
- [`deployment.md`](./docs/deployment.md) — S3, CloudFront, _cache
  policy_.
- [`development.md`](./docs/development.md) — ambiente local,
  variáveis, _worktrees_, testes.

## _Scripts_

```bash
pnpm dev                  # Vite dev server em http://localhost:4322
pnpm build                # tsc + vite build
pnpm preview              # serve o build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage

# Pipeline de dados
pnpm aggregate            # SIA-PA → build/parquet/ (Hive)
pnpm build:consolidate    # → build/parquet-opt/ (otimizado p/ WASM)
pnpm build:parquet-index  # → build/manifest/index.json
pnpm build:geo-tiles      # IBGE → build/geo/brasil.pmtiles
pnpm upload:aws           # publica tudo no S3
```

## Configuração

### _Token_ do Mapbox

Crie `packages/site/.env.local`:

```ini
VITE_MAPBOX_TOKEN=pk.seu_token_aqui
```

_Token_ gratuito em [account.mapbox.com](https://account.mapbox.com/).
Sem o _token_, a página renderiza aviso em texto em vez do mapa (fail
graceful).

### Regenerar dados a partir do FTP DATASUS

```bash
# Smoke (1 UF, 1 ano) — poucos MB, minutos
pnpm -F @datasus-brasil/site aggregate --ufs AC --years 2024

# Ano inteiro, todas as UFs — download pesado, horas
pnpm -F @datasus-brasil/site aggregate --ufs ALL --years 2024

# Série histórica
pnpm -F @datasus-brasil/site aggregate --ufs ALL --years 2008-2025
```

Cache FTP: `~/.cache/datasus-brasil`. Ver
[`data-pipeline.md`](./docs/data-pipeline.md) para fluxo completo.

## Geometrias

`build/geo/brasil.pmtiles` contém UFs (fonte _click_that_hood_
simplificado) e municípios (API de malhas IBGE v4, qualidade
`intermediaria`). Duas _layers_, _zoom_ 2–10, ~12 MB.

Regeneração: `pnpm build:geo-tiles` (exige `tippecanoe` e `pmtiles` —
`brew install tippecanoe pmtiles`).

## Limitações conhecidas

Ver página `/sobre` no site — sub-registro do SIA-SUS, cobertura LOINC
do catálogo, semântica de `PA_QTDAPR`/`PA_VALAPR`, recorte por
estabelecimento executor (não residência do paciente).
