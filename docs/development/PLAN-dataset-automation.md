# PRE-209 — Auditoria, refresh automatizado e distribuição do dataset SIA-PA

Linear: [PRE-209](https://linear.app/precisa-saude/issue/PRE-209) (filho de PRE-206).
Branch: `rlueder/pre-209-dataset-automation`.

## Objetivo

Fechar o ciclo operacional do dataset SIA-PA publicado pelo site
`datasus-brasil`. Hoje funciona manual: rodar `aggregate`, rodar
`consolidate`, rodar `build:parquet-index`, rodar `upload:aws`,
invalidar CloudFront. E não há trilha de auditoria — pesquisadores não
têm como verificar que o Parquet publicado bate com o DBC do DATASUS.

Três entregas que fecham o loop:

1. **Auditoria** — `provenance.json` por partição com SHA256 do DBC
   fonte, gitSha do script, versão do decoder, row counts. Permite
   reexecução determinística e validação byte-a-byte.
2. **Refresh automático** — GH Actions semanal sondando o FTP DATASUS,
   detectando novas competências publicadas, agregando o delta,
   consolidando, fazendo upload e invalidando CloudFront. Zero toque
   humano no caminho feliz.
3. **Distribuição versionada** — cada release vira tag GitHub + DOI
   Zenodo, com changelog gerado automaticamente.

## Entregas

### 1. Provenance por partição

Novo script `packages/site/scripts/emit-provenance.ts`:

- Escaneia `build/parquet/ano=YYYY/uf=XX/part.parquet`.
- Para cada partição, identifica os DBC fonte (`PA{UF}{YYMM}.dbc` para
  todos os 12 meses do ano).
- Lê do cache local (`~/.cache/datasus-brasil/dissemin/publicos/SIASUS/...`),
  computa SHA256.
- Emite `build/provenance/ano=YYYY/uf=XX/part.provenance.json`:

```json
{
  "partition": { "ano": 2024, "uf": "AC" },
  "output": {
    "file": "ano=2024/uf=AC/part.parquet",
    "rows": 1737,
    "sha256": "..."
  },
  "sources": [
    {
      "file": "PAAC2401.dbc",
      "ftpPath": "/dissemin/publicos/SIASUS/200801_/Dados/PAAC2401.dbc",
      "sha256": "...",
      "bytes": 845321
    },
    …
  ],
  "pipeline": {
    "decoder": "@precisa-saude/datasus-dbc@X.Y.Z",
    "datasusSdk": "@precisa-saude/datasus@X.Y.Z",
    "aggregateScript": "scripts/aggregate-sia-parquet.ts@<gitSha>",
    "filter": "isSigtapLaboratorio",
    "enrichment": "sigtapToLoinc (loinc-biomarkers.json)",
    "schemaVintage": "SIA-PA 2008+"
  },
  "generatedAt": "2026-04-24T12:00:00Z"
}
```

Publicado junto com o Parquet no S3/CloudFront e no GitHub Release.

Pesquisador externo: baixa `PAAC2401.dbc` direto do `ftp.datasus.gov.br`,
compara SHA256. Se bate, clona o repo no gitSha indicado, roda
`pnpm aggregate --ufs AC --years 2024` e compara o Parquet emitido
byte-a-byte com o publicado. Determinismo → sem fabricação.

### 2. Determinismo do `aggregate-sia-parquet.ts`

Hoje a ordem das linhas no Parquet depende da ordem de streaming do
DBF + hash maps internos do DuckDB. Para reexecução determinística:

- Fixar `ORDER BY (ufSigla, municipioCode, competencia, loinc)` no
  `COPY ... TO`.
- Especificar `COMPRESSION 'zstd'`, `ROW_GROUP_SIZE 100000` explicitamente.
- Ordenar as listas de entrada (UFs, anos, meses) em `parseArgs`.

Mudança é pequena (~5 linhas) e não altera os dados, só a ordem física
no arquivo.

### 3. State file + detecção de delta

Novo arquivo `state/dataset.json` (versionado no repo):

```json
{
  "schemaVersion": 1,
  "lastRun": "2026-04-24T12:00:00Z",
  "processed": {
    "AC": { "2024-12": { "sourceMtime": "2025-02-15T...", "sourceSize": 845321, "sha256": "..." } },
    …
  }
}
```

Novo script `packages/site/scripts/detect-new.ts`:

- Conecta FTP `ftp.datasus.gov.br`, lista
  `/dissemin/publicos/SIASUS/200801_/Dados/`.
- Filtra `PA*.dbc`.
- Compara com `state/dataset.json`.
- Emite `state/pending.json` com lista de arquivos novos/modificados:

```json
{
  "detectedAt": "2026-04-24T12:00:00Z",
  "pending": [
    { "uf": "AC", "year": 2025, "month": 1, "ftpPath": "/…/PAAC2501.dbc" },
    …
  ],
  "latestCompetencia": "2025-01"
}
```

Em CI, emite `::set-output hasNew=true/false` + `latestCompetencia`.

### 4. Flag `--from-pending` no `aggregate-sia-parquet.ts`

Quando presente, ignora `--ufs`/`--years` e lê a lista de
`state/pending.json`. Processa só o delta; cada arquivo processado
com sucesso é adicionado ao state file.

### 5. GitHub Actions workflow

`.github/workflows/refresh-sia-pa.yml`:

```yaml
on:
  schedule: [{ cron: '0 6 * * 1' }] # toda segunda 06:00 UTC
  workflow_dispatch:

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: write # commit state + release
      id-token: write # OIDC AWS
    steps:
      - checkout
      - setup node / pnpm / install
      - run: detect-new.ts  (sai com hasNew=false se nada)
      - run: aggregate-sia-parquet.ts --from-pending
      - run: build:consolidate
      - run: build:parquet-index
      - run: emit-provenance.ts
      - OIDC AWS → upload:aws
      - CloudFront invalidation
      - gh-release com assets (manifest/index.json, uf-totals.parquet, provenance/*.json)
      - git commit state/dataset.json + push
```

Runner GH Actions tem 14GB disk / 7GB RAM — suficiente para
processar uma competência (27 UFs × ~5MB DBC = ~135MB download total).

AWS credencial via OIDC role-to-assume (sem secret estático).

### 6. Integração Zenodo

Passo manual uma vez: habilitar webhook GitHub ↔ Zenodo no repo
(https://zenodo.org/account/settings/github/). A partir daí cada tag
de release vira um DOI automaticamente.

Adicionar `CITATION.cff` no repo apontando para o DOI do dataset
(será preenchido na primeira release).

### 7. Documento de atribuição

Novo `packages/site/docs/data-license.md`:

- Cita Lei 12.527/2011 (Acesso à Informação) e Decreto 8.777/2016
  (Política de Dados Abertos) como base legal da redistribuição.
- Indica CC-BY 4.0 como licença da nossa agregação.
- Recomenda formato de citação bibliográfica.
- Flagra limitações conhecidas (sub-registro do SIA-PA, vintage de
  schema, SP com split files).

Linkado do README raiz e da página Sobre do site.

## Plano de commits (Conventional Commits, escopos válidos)

1. `feat(site): provenance por partição com SHA256 + gitSha`
   — `emit-provenance.ts`, determinismo no `aggregate-sia-parquet.ts`,
   testes.
2. `feat(site): detect-new.ts e state/dataset.json`
   — script + schema inicial + testes com FTP mock.
3. `feat(site): flag --from-pending em aggregate-sia-parquet`
4. `ci: workflow semanal refresh-sia-pa`
   — `.github/workflows/refresh-sia-pa.yml`, secrets documentados no
   README de deploy.
5. `docs: atribuição de dados DATASUS + CC-BY 4.0`
   — `packages/site/docs/data-license.md`, `CITATION.cff`, link nos
   READMEs.

## Fora de escopo

- **Parquet-raw archival** (preservar todas as colunas PA\_\*): trade-off
  disco × queryability pendente. Issue separada se valer.
- **SP split files** (`PASP{YY}{MM}{a,b,c}.dbc`): bloqueado no
  `@precisa-saude/datasus` core. Issue separada.
- **Cache DBC comprimido** (zstd no lugar de guardar .dbc): ganho
  marginal sem mudar UX. Baixa prioridade.

## Verificação end-to-end

1. `pnpm -F @datasus-brasil/site run emit-provenance` → gera JSONs;
   comparar SHA256 contra `sha256sum` independente de um DBC da
   fixture.
2. `pnpm -F @datasus-brasil/site run detect-new` com state-file
   adulterado (removendo a última competência) → deve listar aquela
   competência como pending.
3. `pnpm aggregate --from-pending` com state-file simulado →
   processa só o delta; state atualizado pós-sucesso.
4. Dry-run `workflow_dispatch` do refresh em branch temporária →
   gera draft release.
5. Primeiro release real (competência mais recente) deve aparecer no
   GitHub + (após setup Zenodo) DOI associado.
