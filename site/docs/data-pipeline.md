# Pipeline de dados

Documenta cada _script_ em `site/scripts/` — objetivo,
argumentos, entrada, saída, e _schema_ dos artefatos gerados.

## Pipeline _end-to-end_ (datasus-parquet → datasus-viz)

A cadeia completa atravessa **dois repos** com bucket S3 compartilhado
(`precisa-saude-datasus-brasil`, _fronted_ por `dfdu08vi8wsus.cloudfront.net`):

```
                             ┌──────────────── datasus-parquet ────────────────┐
ftp.datasus.gov.br → archive-sia-pa → emit-provenance → aws s3 sync → s3://…/sia-pa/{ano,uf,mes}=…/part.parquet
                                                                       └→ s3://…/sia-pa/provenance/…
                             └──────────────────────────────────────────────────┘
                                                                            │
                                                                       (CloudFront)
                                                                            │
                             ┌─────────────────── datasus-viz ──────────────┴───┐
                             aggregate-sia-parquet → consolidate-parquet → build-parquet-index
                                                                            └→ build-geo-tiles
                                                                            └→ upload-aws → s3://…/parquet-opt/, manifest/
                             └────────────────────────────────────────────────┘
                                                                            │
                                                                            ▼
                                                                   site (CloudFront)
```

**O que cada metade entrega:**

- **`datasus-parquet`** publica os _Parquets brutos_ (1:1 com os DBC
  originais, todas as colunas, layout
  `ano=YYYY/uf=XX/mes=MM/part.parquet`) acompanhados de
  `provenance/*.json` (SHA256 + _schema_ + git SHA). Documentado em
  [`datasus-parquet/README.md`](https://github.com/Precisa-Saude/datasus-parquet#readme).
- **`datasus-viz`** consome os _Parquets brutos_ via CloudFront,
  filtra para SIGTAP `02.02` (laboratório clínico), enriquece com
  LOINC, agrega por `(município, biomarcador, competência)` e publica
  os artefatos otimizados que o site lê (`parquet-opt/`,
  `manifest/index.json`, `geo/brasil.pmtiles`).

### _Gotcha_ inter-repo: novos anos no S3 não aparecem automaticamente no site

Quando `datasus-parquet` publica um ano novo em
`s3://…/sia-pa/ano=YYYY/`, o site **não enxerga sozinho** — o pipeline
do `datasus-viz` precisa rodar de novo (`aggregate` em diante) para
incorporar esses dados em `parquet-opt/` e `manifest/index.json`.

Sintoma típico: anos faltando ou competências esparsas na _UI_, mesmo
com os _Parquets brutos_ presentes em `s3://…/sia-pa/`. Diagnóstico:

```bash
# Anos no S3 bruto (datasus-parquet)
aws s3 ls s3://precisa-saude-datasus-brasil/sia-pa/ | grep ano=

# Anos no manifesto que o site lê
curl -s https://dfdu08vi8wsus.cloudfront.net/manifest/index.json | jq '.years'
```

Se as listas divergirem, falta rodar o pipeline do `datasus-viz` (ver
[Republicar artefatos do site](#republicar-artefatos-do-site)) para
preencher o _gap_.

### Quando rodar cada metade

| Mudança                                               | Repo a rodar                      | _Trigger_ típico                                                        |
| ----------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| Novo mês/ano de microdados publicado pelo DATASUS     | `datasus-parquet` → site          | _cron_ semanal `refresh.yml`; _backfill_ manual via `backfill.yml`      |
| _Backfill_ histórico de anos antigos (e.g. 2009–2019) | `datasus-parquet` → site          | `backfill.yml` com `--years` específico, ou execução manual no _runner_ |
| Mapeamento SIGTAP→LOINC mudou                         | `datasus-viz`                     | Republicação completa após `pnpm update @precisa-saude/datasus-sdk`     |
| Geometrias municipais atualizadas                     | `datasus-viz` (`build:geo-tiles`) | _Refresh_ pontual, não acoplado aos dados                               |
| _Schema_ do _Parquet bruto_ mudou                     | Ambos                             | Schema-evolution test em `datasus-parquet` antes; depois rerun no viz   |

---

Para a motivação arquitetural (por que consolidar, por que Parquet,
por que PMTiles), ver [`architecture.md`](./architecture.md).

## Fluxo do `datasus-viz` (este documento)

```
aggregate-sia-parquet → consolidate-parquet → build-parquet-index
                                            └→ build-geo-tiles
                                            └→ upload-aws
```

---

## 1. `aggregate-sia-parquet.ts`

**Comando:** `pnpm -F @datasus-viz/site aggregate`

Lê os _Parquets brutos_ publicados por `datasus-parquet` via
CloudFront (`https://dfdu08vi8wsus.cloudfront.net/sia-pa/ano=YYYY/uf=XX/mes=MM/part.parquet`),
filtra para laboratório clínico (SIGTAP `02.02`), enriquece com LOINC
via `@precisa-saude/datasus-sdk` e agrega por `(município, LOINC,
competência)`, escrevendo Parquet em layout _Hive_.

> **Não toca FTP DATASUS nem cache local de DBC.** Toda a leitura
> acontece via HTTP _Range Requests_ contra os _Parquets brutos_ já
> publicados. Se um (uf, ano, mês) não existe no S3, o `HEAD` falha
> com 404 e o mês é pulado silenciosamente — exatamente o que
> acontece com _split files_ MG/RJ/SP em janelas onde ainda não foram
> processados.

### Argumentos

| _Flag_         | Obrigatório | _Default_                              | Descrição                                                                             |
| -------------- | ----------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `--ufs`        | Não         | `ALL`                                  | Lista de siglas separadas por vírgula (`AC,AL,SP`). `ALL` expande para as 27.         |
| `--years`      | Não         | `2008-{ano corrente}`                  | Ano único (`2024`), lista (`2022,2024`) ou intervalo (`2008-2025`).                   |
| `--out`        | Não         | `build/parquet`                        | Diretório de saída.                                                                   |
| `--source-url` | Não         | `https://dfdu08vi8wsus.cloudfront.net` | _Base URL_ dos _Parquets brutos_ (útil para apontar para um _mirror_).                |
| `--force`      | Não         | `false`                                | Reagrega partições já presentes em `build/parquet/` (default pula partições prontas). |

> **Importante:** o _flag_ antigo `--months` **não existe**. Usa
> `--years`; o _script_ cobre todos os meses de cada ano automaticamente.

### Exemplos

```bash
# Default: preencher o que falta em todas as UFs × 2008–ano corrente.
# Idempotente — partições já agregadas são puladas, 404s do S3 ignorados.
# Rodar depois que datasus-parquet publicou novos anos brutos no S3.
pnpm -F @datasus-viz/site aggregate

# Reagregação completa (após bump de SDK ou mudança de mapeamento SIGTAP→LOINC)
pnpm -F @datasus-viz/site aggregate -- --force

# Escopo restrito (smoke / debug)
pnpm -F @datasus-viz/site aggregate -- --ufs AC --years 2024
```

### _Cache_ e _CloudFront_

DuckDB usa `httpfs` com _Range Requests_, então CloudFront serve os
_footers_ direto e a quantidade de bytes baixada por _query_ é uma
fração do _Parquet_ inteiro. Reexecuções com os mesmos `(UF, ano,
mês)` re-leem da rede (sem _cache_ local), mas o CloudFront amortiza
o custo no _origin_. Para ambientes _offline_, aponte `--source-url`
para um _mirror_ HTTP local.

### Saída

```
build/parquet/
├── ano=2024/
│   ├── uf=AC/part.parquet
│   ├── uf=AL/part.parquet
│   └── ... (até 27 UFs)
└── ano=YYYY/...
```

### _Schema_ por arquivo

| Coluna             | Tipo     | Observação                                |
| ------------------ | -------- | ----------------------------------------- |
| `competencia`      | `string` | `YYYY-MM` (ex.: `2024-01`)                |
| `loinc`            | `string` | Código LOINC (ex.: `4548-4`)              |
| `municipioCode`    | `string` | 6 dígitos IBGE (UF + sequencial, sem DV)  |
| `municipioNome`    | `string` | Nome oficial IBGE                         |
| `ufSigla`          | `string` | `AC`, `SP`, …                             |
| `volumeExames`     | `bigint` | Soma de `PA_QTDAPR` (quantidade aprovada) |
| `valorAprovadoBRL` | `double` | Soma de `PA_VALAPR` em reais (2 decimais) |

Compressão: `ZSTD`.

### Observações

- Apenas linhas com LOINC mapeado sobrevivem. Procedimentos de
  laboratório sem mapeamento são descartados silenciosamente — o
  manifesto registra quais LOINC efetivamente aparecem.
- `PA_UFMUN` é o identificador oficial do SIA (6 dígitos, sem DV).
  Join com IBGE é direto por esse código.

---

## 2. `consolidate-parquet.ts`

**Comando:** `pnpm -F @datasus-viz/site build:consolidate`

Lê `build/parquet/` (layout Hive) e gera **dois** _datasets_
otimizados para consumo via DuckDB WASM no browser.

### Entrada

`build/parquet/ano=*/uf=*/part.parquet` (saída do _step_ 1).

### Saída

```
build/parquet-opt/
├── uf-totals.parquet           ← agregado nacional (~500 KB)
└── uf=XX/part.parquet          ← 27 arquivos, um por UF
```

#### `uf-totals.parquet`

Agregado nacional: `GROUP BY ufSigla, loinc, competencia`. Uma linha
por combinação `(UF, biomarcador, competência)`.

| Coluna             | Tipo     |
| ------------------ | -------- |
| `ufSigla`          | `string` |
| `loinc`            | `string` |
| `competencia`      | `string` |
| `volumeExames`     | `bigint` |
| `valorAprovadoBRL` | `double` |

#### `uf=XX/part.parquet`

27 arquivos (um por UF), cada um com todos os anos inline. Mantém
granularidade de município.

| Coluna             | Tipo     |
| ------------------ | -------- |
| `ano`              | `int`    |
| `competencia`      | `string` |
| `loinc`            | `string` |
| `municipioCode`    | `string` |
| `municipioNome`    | `string` |
| `volumeExames`     | `bigint` |
| `valorAprovadoBRL` | `double` |

### Por que este _step_ existe

Rationale completo em [`architecture.md`](./architecture.md#por-que-parquet-consolidado-e-não-486-arquivos).
Resumo: corta ~95 % dos Range Requests por _query_.

---

## 3. `build-parquet-index.ts`

**Comando:** `pnpm -F @datasus-viz/site build:parquet-index`

Escaneia `build/parquet/` e emite um manifesto JSON pequeno que o site
lê no _boot_ para popular seletores e habilitar _drill-down_ — sem
precisar _query_ SQL para metadados.

### Saída

`build/manifest/index.json`:

```json
{
  "years": [2024],
  "availableUFs": ["AC", "AL", "AM", "..."],
  "competencias": ["2024-01", "2024-02", "..."],
  "biomarkers": [{ "code": "HbA1c", "display": "Hemoglobina glicada", "loinc": "4548-4" }],
  "geradoEm": "2026-04-23T17:39:00.000Z"
}
```

- `biomarkers` é a interseção do catálogo `listBiomarkers()` com os
  LOINC que **efetivamente** aparecem nos Parquets (ordenado por
  `display`).
- `availableUFs` vem da listagem do _filesystem_ — representa cobertura
  real, não o _superset_ das 27 UFs.

---

## 4. `build-geo-tiles.sh`

**Comando:** `pnpm -F @datasus-viz/site build:geo-tiles`

Baixa geometrias oficiais do IBGE, adiciona propriedade `uf` em cada
_feature_ de município, consolida tudo num único GeoJSON e empacota
via `tippecanoe` + `pmtiles`.

### Pré-requisitos

```bash
brew install tippecanoe pmtiles
```

### Fontes

- **UFs:** `click_that_hood` (GitHub, já simplificado, ~3,3 MB).
- **Municípios:** [API IBGE v4](https://servicodados.ibge.gov.br/api/v4/malhas/estados)
  — 27 _requests_ (um por UF), qualidade `intermediaria`, ~5–15 MB cada.

### Saída

- **Intermediário:** `build/geo-src/` — cada UF em arquivo próprio,
  mais o _merge_ nacional. Cached (não refaz _download_ se existe).
- **Final:** `build/geo/brasil.pmtiles` (~12 MB) — duas _layers_
  (`ufs`, `municipios`), _zoom_ 2–10.

### Flags relevantes do tippecanoe

- `--coalesce-densest-as-needed` — junta polígonos pequenos para não
  desaparecerem em _zoom_ baixo.
- `--detect-shared-borders` — otimiza fronteiras compartilhadas entre
  municípios adjacentes.

Tempo total: 2–3 minutos em rede comum.

---

## 5. `upload-aws.sh`

**Comando:** `pnpm -F @datasus-viz/site upload:aws`

Sincroniza os artefatos consolidados para S3. Requer AWS CLI
configurado com credenciais para `sa-east-1`.

### _Target_

- Bucket: `precisa-saude-datasus-brasil` (sobrescrevível via `$BUCKET`).
- Região: `sa-east-1`.
- _Fronted_ por CloudFront `dfdu08vi8wsus.cloudfront.net` (OAC).

### Layout no S3

```
s3://precisa-saude-datasus-brasil/
├── geo/brasil.pmtiles
├── parquet-opt/
│   ├── uf-totals.parquet
│   └── uf=XX/part.parquet × 27
└── manifest/index.json
```

### _Cache policy_

| Artefato     | `Cache-Control`                       |
| ------------ | ------------------------------------- |
| PMTiles      | `public, max-age=31536000, immutable` |
| Parquet      | `public, max-age=31536000, immutable` |
| `index.json` | `public, max-age=3600`                |

PMTiles e Parquet são reemitidos sempre que os dados mudam — nomes
não contêm _hash_, mas o _cache_ de 1 ano é seguro porque qualquer
atualização é precedida de novo _run_ do pipeline inteiro (a
recomendação é invalidar caminhos específicos no CloudFront após
publicar se a mudança precisa propagar antes de 1 hora — ver
[`deployment.md`](./deployment.md)).

O _script_ **não** invalida o CloudFront. Se for necessário,
invalidar manualmente:

```bash
aws cloudfront create-invalidation \
  --distribution-id <DIST_ID> \
  --paths '/parquet-opt/*' '/geo/*' '/manifest/index.json'
```

---

## Republicar artefatos do site

### Automático: workflow `refresh.yml`

Cron semanal (segunda 08:00 UTC) em
[`.github/workflows/refresh.yml`](../../.github/workflows/refresh.yml)
roda `aggregate → consolidate → build-parquet-index → upload-aws →
invalidação` no _runner_ GitHub. Idempotente: se nenhum ano/competência
novo apareceu desde o último run, _step_ de upload e invalidação é
pulado (compara o manifesto local com o que está em S3, ignorando o
campo `geradoEm` que muda toda execução).

Disparo manual (`workflow_dispatch`) também disponível, com flag
`forceReaggregate` para reagregar tudo (após bump de SDK / mudança
de mapeamento SIGTAP→LOINC).

_Secrets_ necessários: `AWS_ROLE_ARN` (OIDC), `S3_BUCKET`,
`CLOUDFRONT_DISTRIBUTION_ID`.

### Manual: localmente

Após `datasus-parquet` publicar novos `(ano, UF)` em `s3://…/sia-pa/`,
o pipeline manual completo é:

```bash
# 1. Agregar — default já cobre todas UFs × 2008–ano corrente,
#    pulando partições já agregadas e ignorando 404s do S3.
pnpm -F @datasus-viz/site aggregate

# 2. Consolidar build/parquet/ → build/parquet-opt/
pnpm -F @datasus-viz/site build:consolidate

# 3. Manifesto com years/competencias/UFs/biomarkers
pnpm -F @datasus-viz/site build:parquet-index

# 4. Tiles geográficos (pula se geometria não mudou)
pnpm -F @datasus-viz/site build:geo-tiles

# 5. Publicar parquet-opt/, manifest/index.json, geo/brasil.pmtiles
pnpm -F @datasus-viz/site upload:aws

# 6. Invalidar CloudFront — parquet-opt usa max-age=31536000 immutable,
#    sem invalidação o site continua servindo a versão antiga
aws cloudfront create-invalidation \
  --distribution-id <DIST_ID> \
  --paths '/parquet-opt/*' '/manifest/index.json'
```

> **Forçar reagregação de um ano específico:** apagar
> `build/parquet/ano=YYYY` antes do `aggregate`, ou usar
> `pnpm aggregate -- --force --years YYYY` para sobrescrever.

### _Backfill_ manual (vindo de _build_ local de `datasus-parquet`)

Quando os _Parquets brutos_ foram gerados localmente (e.g. _backfill_
histórico no _runner_) mas não foram publicados via CI, o atalho é
`aws s3 sync` direto do _build_ local antes de rodar a sequência
acima:

```bash
# Em datasus-parquet (no host onde os Parquets foram gerados):
cd ~/Github/precisa-saude/datasus-parquet[-ftp|-transform]
pnpm emit-provenance     # gera build/sia-pa/provenance/

# Sincroniza brutos + provenance (--size-only pula bytes idênticos):
for y in 2009 2010 2011 2012 2013 2014; do
  aws s3 sync build/sia-pa/ano=$y \
    s3://precisa-saude-datasus-brasil/sia-pa/ano=$y \
    --size-only \
    --exclude '*.ndjson' --exclude '*.skipped' \
    --cache-control 'public, max-age=3600'
  aws s3 sync build/sia-pa/provenance/ano=$y \
    s3://precisa-saude-datasus-brasil/sia-pa/provenance/ano=$y \
    --size-only \
    --cache-control 'public, max-age=3600'
done
```

Depois rodar a sequência `aggregate → consolidate → build-parquet-index
→ upload-aws → invalidação` em `datasus-viz` para que o site enxergue
os anos novos.

> **Onde fica o `DIST_ID`:** GH _secret_
> `CLOUDFRONT_DISTRIBUTION_ID` (consumido por
> `datasus-parquet/.github/workflows/backfill.yml` e `refresh.yml`).
> Para invalidação manual, _users_ AWS com a permissão
> `cloudfront:CreateInvalidation` no recurso da distribuição
> conseguem rodar o `create-invalidation` direto.

## _Vintage_ e _schema_ do SIA

O _schema_ do SIA-PA varia entre _vintages_ (2008 ≠ 2024). O pipeline
usa os adaptadores de `@precisa-saude/datasus`, que tratam a tradução.
Em caso de divergência, a regra do repo é explícita (ver `AGENTS.md`):
declarar o _schema_ aplicado nos _logs_ — nunca aplicar transformação
silenciosa entre _vintages_.
