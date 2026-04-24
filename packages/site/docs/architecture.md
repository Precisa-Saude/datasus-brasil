# Arquitetura

Visão geral de como `@datasus-viz/site` transforma microdados do
DATASUS em uma visualização coroplética interativa no navegador.

## Objetivo

Permitir ao usuário final explorar a distribuição espacial de exames
laboratoriais faturados ao SUS — SIA-PA (Produção Ambulatorial)
filtrado para SIGTAP `02.02` e cruzado com LOINC — com _drill-down_ de
UF para município, sem backend dedicado.

## Fluxo de dados ponta a ponta

```
┌───────────────────┐
│ DATASUS FTP       │  ftp.datasus.gov.br (SIA-PA, .dbc mensal)
└─────────┬─────────┘
          │  aggregate-sia-parquet.ts
          │  (filtra SIGTAP 02.02, enriquece com LOINC, agrupa
          │   por município × LOINC × competência)
          ▼
┌─────────────────────────────────────────┐
│ build/parquet/                          │  layout Hive
│  ano=YYYY/uf=XX/part.parquet            │
└─────────┬───────────────────────────────┘
          │  consolidate-parquet.ts
          ▼
┌─────────────────────────────────────────┐
│ build/parquet-opt/                      │
│  uf-totals.parquet    ← nacional        │
│  uf=XX/part.parquet   ← UF (27 arq.)    │
└─────────┬───────────────────────────────┘
          │  build-parquet-index.ts
          ▼
┌─────────────────────────────────────────┐
│ build/manifest/index.json               │
└─────────┬───────────────────────────────┘
          │  build-geo-tiles.sh (IBGE + tippecanoe + pmtiles)
          ▼
┌─────────────────────────────────────────┐
│ build/geo/brasil.pmtiles                │
└─────────┬───────────────────────────────┘
          │  upload-aws.sh
          ▼
┌─────────────────────────────────────────┐
│ S3 (precisa-saude-datasus-brasil)       │
│  + CloudFront (dfdu08vi8wsus)           │
└─────────┬───────────────────────────────┘
          │  HTTPS + Range Requests
          ▼
┌─────────────────────────────────────────┐
│ Navegador                               │
│  ├─ MapLibre GL JS (mapa vetorial)      │
│  ├─ pmtiles protocol (tiles sob demand) │
│  └─ DuckDB WASM (SQL sobre Parquet)     │
└─────────────────────────────────────────┘
```

## Componentes

### Pipeline de dados (_build-time_, Node.js)

| Script                     | Entrada                       | Saída                                |
| -------------------------- | ----------------------------- | ------------------------------------ |
| `aggregate-sia-parquet.ts` | SIA-PA via FTP DATASUS        | `build/parquet/ano=*/uf=*/...`       |
| `consolidate-parquet.ts`   | `build/parquet/`              | `build/parquet-opt/`                 |
| `build-parquet-index.ts`   | `build/parquet/`              | `build/manifest/index.json`          |
| `build-geo-tiles.sh`       | IBGE API v4 + click_that_hood | `build/geo/brasil.pmtiles`           |
| `upload-aws.sh`            | `build/**`                    | `s3://precisa-saude-datasus-brasil/` |

Detalhes de cada script em [`data-pipeline.md`](./data-pipeline.md).

### Distribuição (S3 + CloudFront)

Todos os artefatos de _runtime_ são servidos via CDN. O bucket é
público com CORS permissivo; CloudFront absorve os _cache hits_ de
Range Requests repetidos.

Detalhes em [`deployment.md`](./deployment.md).

### _Runtime_ do navegador

- **MapLibre GL JS** — renderiza o mapa vetorial (WebGL).
- **pmtiles protocol** — registra o handler `pmtiles://` no MapLibre
  para buscar _tiles_ sob demanda de um único arquivo `.pmtiles` via
  Range Requests (sem servidor de _tiles_ dedicado).
- **DuckDB WASM** — executa SQL direto sobre os Parquets servidos
  pelo S3/CloudFront. Usa Range Requests para ler apenas os
  _row-groups_ necessários; a consulta roda em _worker_ à parte da
  _main thread_.
- **React 19 + React Router** — UI, seletores (biomarcador,
  competência), painel de detalhe.

Constantes de URL e _helpers_ ficam em `src/lib/data-source.ts`:

```ts
export const DATA_BASE_URL =
  import.meta.env.VITE_DATA_BASE_URL ?? 'https://dfdu08vi8wsus.cloudfront.net';
export const PMTILES_URL = `${DATA_BASE_URL}/geo/brasil.pmtiles`;
export const MANIFEST_URL = `${DATA_BASE_URL}/manifest/index.json`;
export const UF_TOTALS_PARQUET = `${DATA_BASE_URL}/parquet-opt/uf-totals.parquet`;
export function ufPartitionUrl(ufSigla: string): string {
  return `${DATA_BASE_URL}/parquet-opt/uf=${ufSigla}/part.parquet`;
}
```

## _Boot_ e interação

1. **_Boot_.** Página carrega `manifest/index.json` → popula selects
   de biomarcador e competência, habilita _drill-down_ para as UFs
   com dados.
2. **Visão nacional.** Ao escolher competência, `fetchUfAggregates()`
   dispara um `SELECT ... FROM read_parquet('uf-totals.parquet')
WHERE competencia = ?`. Um _Range Request_, resposta em milissegundos
   (o arquivo é < 1 MB).
3. **_Drill-down_.** _Click_ numa UF dispara `fetchMunicipioAggregates(
uf, competencia)`: DuckDB lê `parquet-opt/uf=XX/part.parquet` com
   _filter pushdown_ por `competencia`. O _layer_ municipal do PMTiles
   é ativado no MapLibre; a geometria já foi baixada.
4. **Troca de biomarcador/competência.** _Refetch_ seletivo da camada
   relevante; o mapa não recarrega.

## Por que Parquet consolidado (e não 486 arquivos)

Cada arquivo Parquet tem ~30–80 KB de _footer_ que o DuckDB precisa
ler (via Range Request) para saber quais _row-groups_ podar. Com 18
anos × 27 UFs = 486 arquivos, a leitura de metadados sozinha dispara
~1 000 _requests_ por _query_ nacional.

`consolidate-parquet.ts` produz dois _datasets_ derivados:

- **`uf-totals.parquet`** (~500 KB) — agregado nacional pré-pronto.
  Uma _query_ por competência → **1 Range Request**.
- **`uf=XX/part.parquet`** (27 arquivos, um por UF) — 18 anos inline.
  _Drill-down_ da UF → **1 Range Request** por troca de UF.

Corta ~95 % do _overhead_ de metadata sem sacrificar _pushdown_ de
filtro (o Hive partitioning continua funcionando para `ano`).

## Por que PMTiles (e não _tile server_ tradicional)

Um `.pmtiles` é um arquivo único (~12 MB para UF + municípios do
Brasil) que encapsula o _tileset_ MVT inteiro num formato com
_directory_ interno para Range Requests. Basta um S3 com CORS — sem
_tile server_, sem processo em Node, sem invalidar _cache_ de
_subdomain_ por _path_ de _tile_. `pmtiles-protocol` registra o
_loader_ no MapLibre e dali em diante é transparente.

## Decisões explícitas

- **Saída JSON-first apenas no topo (CLI/manifest).** A camada
  transporte entre _build_ e navegador é Parquet — eficiente para
  Range Requests e _columnar pruning_. JSON só no manifesto (pequeno,
  indexado por _freshness_) e nos exemplos de CLI. Ver regra em
  `AGENTS.md` (repo).
- **Sem backend.** Todo SQL roda no browser via WASM. Estado do
  servidor = arquivos estáticos. Simplifica _deploy_ e custo.
- **Fail graceful sem Mapbox.** Sem `VITE_MAPBOX_TOKEN`, a página
  renderiza aviso em texto em vez de quebrar.
- **Filtro fixo SIGTAP `02.02`.** Demo inicial é só laboratório
  clínico. Ampliar exige repensar tamanho dos Parquets e UI.
- **Sem DV no `municipioCode`.** SIA usa 6 dígitos (UF + sequencial).
  Join com IBGE é direto; não há cálculo de dígito verificador.

## Ver também

- [`data-pipeline.md`](./data-pipeline.md) — cada script em detalhe
- [`deployment.md`](./deployment.md) — S3, CloudFront, _cache policy_
- [`development.md`](./development.md) — ambiente local e _worktrees_
