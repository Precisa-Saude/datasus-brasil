# PRE-209 — Agregado Precisa (lab + LOINC) — ferramentas e auditoria

Linear: [PRE-209](https://linear.app/precisa-saude/issue/PRE-209).
Branch: `rlueder/pre-209-dataset-automation`.

## Contexto pós-split

Depois do split de repos (PRE-210), **datasus-viz não ingere DBC**. A
ingestão do FTP DATASUS e a publicação do raw Parquet canônico são
responsabilidade exclusiva do
[`datasus-parquet`](https://github.com/Precisa-Saude/datasus-parquet).

`datasus-viz` consome o raw Parquet via HTTPS (CloudFront) em dois
momentos:

1. **Em build / CI** — derivação Precisa-específica (filtro SIGTAP
   02.02 + enriquecimento LOINC) pra gerar o `parquet-opt/` consumido
   pelo site.
2. **Em runtime no browser** — DuckDB WASM lê `parquet-opt/` direto do
   CloudFront via Range Requests.

## Escopo deste ticket

Melhorias no derivador Precisa (`aggregate-sia-parquet.ts`) e
documentação de atribuição.

### Entregas

- Determinismo em `aggregate-sia-parquet.ts`: ORDER BY fixo,
  ROW_GROUP_SIZE explícito, UFs e anos ordenados
- Per-month partitions — fix do GC-thrashing em UFs grandes (MG/RJ/SP
  tinham year-level que estourava heap Node)
- Flag `--from-pending` — processa delta a partir de
  `state/pending.json` (produzido pelo `datasus-parquet`)
- `packages/site/docs/data-license.md` — atribuição DATASUS
  (Lei 12.527, Decreto 8.777) + CC-BY 4.0 da derivação Precisa

## Fora de escopo — foi pro `datasus-parquet`

- `detect-new.ts` (FTP sonar) — canonical em
  `datasus-parquet/scripts/detect-new.ts`
- `emit-provenance.ts` (SHA256 DBC + metadata) — canonical em
  `datasus-parquet/scripts/emit-provenance.ts`
- `state/dataset.json` — state de ingestão pertence ao ingestor
- Workflow `refresh-sia-pa.yml` — cron de ingestão FTP → raw é do
  `datasus-parquet`

## Follow-up

- Rewrite de `aggregate-sia-parquet.ts` pra ler do raw publicado em
  `datasus-parquet` via HTTPS em vez de DBC direto do FTP. Remove
  dependência do `@precisa-saude/datasus-sdk` e do cache local de 55GB.
- Workflow em `datasus-viz` disparado por webhook de release do
  `datasus-parquet` que regenera `parquet-opt/` + faz upload pro
  CloudFront do site.
- Zenodo DOI pro dataset (pertence ao `datasus-parquet`, não viz).
