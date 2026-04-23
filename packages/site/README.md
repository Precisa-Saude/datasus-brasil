# @datasus-brasil/site

Visualização geográfica interativa de biomarcadores e exames
laboratoriais faturados ao SUS — SIA-PA (Produção Ambulatorial)
filtrado para SIGTAP `02.02` (laboratório clínico) e cruzado com o
catálogo LOINC.

## Stack

Vite + React 19 + Tailwind v4 + shadcn + `@precisa-saude/ui`/`themes` +
Mapbox GL JS. Mesma stack de `fhir-brasil/site` e `medbench-brasil/site`.

## Scripts

```bash
pnpm dev        # Vite dev server em http://localhost:4322
pnpm build      # tsc + vite build
pnpm preview    # serve o build
pnpm lint
pnpm typecheck
pnpm test
pnpm aggregate  # regenera public/data/sia-pa-*.json a partir do SIA-SUS
```

## Configuração

### Token do Mapbox

O site usa Mapbox GL JS. Obtenha um token gratuito em
[account.mapbox.com](https://account.mapbox.com/) e defina num arquivo
`.env.local` na raiz de `packages/site/`:

```
VITE_MAPBOX_TOKEN=pk.seu_token_aqui
```

Sem o token, a página renderiza uma mensagem explicativa em vez do
mapa (fail graceful).

### Agregar dados SIA-PA

O site consome três artefatos pré-computados em `public/data/`:

- `sia-pa-index.json` — biomarcadores e competências cobertas.
- `sia-pa-uf.json` — agregado por UF × LOINC × competência.
- `sia-pa-{UF}-municipios.json` — agregado municipal (lazy-load).

Para regenerar a partir do FTP DATASUS:

```bash
# Apenas AC (smoke — poucos MBs):
pnpm -F @datasus-brasil/site aggregate --ufs AC --months 2024-01..2024-01

# Ano inteiro em todas as UFs (download pesado, minutos/horas):
pnpm -F @datasus-brasil/site aggregate \
  --ufs AC,AL,AM,AP,BA,CE,DF,ES,GO,MA,MG,MS,MT,PA,PB,PE,PI,PR,RJ,RN,RO,RR,RS,SC,SE,SP,TO \
  --months 2024-01..2024-12
```

O cache FTP fica em `~/.cache/datasus-brasil` — reexecuções com os
mesmos UF × mês batem cache e não refazem download.

## Geometrias

Shapefiles IBGE simplificados (geobr/IPEA) em `public/geo/`:

- `uf.geojson` — 27 UFs, ~180KB (simplificação 8% via mapshaper).
- `municipios/{UF}.geojson` — baixado sob demanda do drill-down. Fonte
  direta da [API de malhas IBGE v4](https://servicodados.ibge.gov.br/api/v4/malhas/estados)
  (qualidade "intermediaria"). Apenas AC está commitado neste MVP;
  adicione UFs rodando o script de agregação.

## Limitações conhecidas

Ver página `/sobre` no site — sub-registro do SIA-SUS, cobertura LOINC
do catálogo, semântica de `PA_QTDAPR`/`PA_VALAPR`, recorte por
estabelecimento executor (não residência do paciente).
