# Pipeline de dados

Documenta cada _script_ em `packages/site/scripts/` — objetivo,
argumentos, entrada, saída, e _schema_ dos artefatos gerados.

Fluxo completo:

```
aggregate-sia-parquet → consolidate-parquet → build-parquet-index
                                            └→ build-geo-tiles
                                            └→ upload-aws
```

Para a motivação arquitetural (por que consolidar, por que Parquet,
por que PMTiles), ver [`architecture.md`](./architecture.md).

---

## 1. `aggregate-sia-parquet.ts`

**Comando:** `pnpm -F @datasus-brasil/site aggregate`

Baixa SIA-PA do FTP DATASUS por mês × UF, filtra para laboratório
clínico (SIGTAP `02.02`), enriquece com LOINC via
`@precisa-saude/datasus` e agrega por `(município, LOINC,
competência)`, escrevendo Parquet em layout Hive.

### Argumentos

| _Flag_            | Obrigatório | _Default_       | Descrição                                                                     |
| ----------------- | ----------- | --------------- | ----------------------------------------------------------------------------- |
| `--ufs`           | Não         | `AC`            | Lista de siglas separadas por vírgula (`AC,AL,SP`). `ALL` expande para as 27. |
| `--years`         | Não         | `2024`          | Ano único (`2024`), lista (`2022,2024`) ou intervalo (`2008-2025`).           |
| `--out`           | Não         | `build/parquet` | Diretório de saída.                                                           |
| `--throttle-ms`   | Não         | `500`           | Pausa entre _requests_ FTP (cortesia para o servidor).                        |
| `--year-pause-ms` | Não         | `5000`          | Pausa entre anos (permite _checkpoint_ e observação de _logs_).               |

> **Importante:** o _flag_ antigo `--months` **não existe**. Usa
> `--years`; o _script_ cobre todos os meses de cada ano automaticamente.

### Exemplos

```bash
# Smoke (1 UF, 1 ano) — poucos MB, termina em minutos
pnpm -F @datasus-brasil/site aggregate --ufs AC --years 2024

# Ano inteiro, todas as UFs — download pesado, horas
pnpm -F @datasus-brasil/site aggregate --ufs ALL --years 2024

# Série histórica
pnpm -F @datasus-brasil/site aggregate --ufs ALL --years 2008-2025
```

### Cache

O pacote `@precisa-saude/datasus` mantém _cache_ FTP local em
`~/.cache/datasus-brasil`. Reexecuções com os mesmos (UF × mês) não
refazem _download_.

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

**Comando:** `pnpm -F @datasus-brasil/site build:consolidate`

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

**Comando:** `pnpm -F @datasus-brasil/site build:parquet-index`

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

**Comando:** `pnpm -F @datasus-brasil/site build:geo-tiles`

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

**Comando:** `pnpm -F @datasus-brasil/site upload:aws`

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

## _Workflow_ completo

Republicar dados do zero:

```bash
# 1. Agregar microdados
pnpm -F @datasus-brasil/site aggregate --ufs ALL --years 2024

# 2. Consolidar
pnpm -F @datasus-brasil/site build:consolidate

# 3. Gerar manifesto
pnpm -F @datasus-brasil/site build:parquet-index

# 4. Gerar tiles (pula se geometria não mudou)
pnpm -F @datasus-brasil/site build:geo-tiles

# 5. Publicar
pnpm -F @datasus-brasil/site upload:aws
```

## _Vintage_ e _schema_ do SIA

O _schema_ do SIA-PA varia entre _vintages_ (2008 ≠ 2024). O pipeline
usa os adaptadores de `@precisa-saude/datasus`, que tratam a tradução.
Em caso de divergência, a regra do repo é explícita (ver `AGENTS.md`):
declarar o _schema_ aplicado nos _logs_ — nunca aplicar transformação
silenciosa entre _vintages_.
