# datasus-viz

Geo-visualização interativa de microdados do DATASUS — agregações SIA-SUS
de laboratório (SIGTAP 02.02 + LOINC) em choropleth Brasil → UF → município.

## Em que família de repos este vive

Este repositório é o **viz consumer** do ecossistema DATASUS open-source da
Precisa Saúde. Para cada responsabilidade existe um repo dedicado:

| Repo                                                                   | Papel                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [datasus-dbc](https://github.com/Precisa-Saude/datasus-dbc)            | Decoder DBC/DBF puro TS (PKWARE DCL Implode + xBase), zero dependências nativas                                                          |
| [datasus-sdk](https://github.com/Precisa-Saude/datasus-sdk)            | SDK de alto nível — FTP cliente, schemas tipados (SIA-PA, CNES-ST), terminologia (IBGE, LOINC, SIGTAP, TUSS, CBO), labeling e agregações |
| [datasus-parquet](https://github.com/Precisa-Saude/datasus-parquet)    | Arquivo público de microdados em Parquet (1:1 do DBC oficial, provenance SHA256), **recurso citável** para pesquisadores                 |
| [datasus-viz](https://github.com/Precisa-Saude/datasus-viz) **(este)** | Site/CLI de visualização consumindo o arquivo público                                                                                    |

## Escopo deste repo

- **`packages/site`** — site Vite/React + MapLibre GL JS + DuckDB WASM com
  choropleth de biomarcadores laboratoriais por competência, com drill-down
  UF → município. Consome `parquet-opt/` derivado do arquivo público.
- **`packages/cli`** — CLI `datasus-brasil` (nome histórico preservado para
  compatibilidade) para exploração ad-hoc de SIA-PA e CNES-ST com saída
  JSON/JSONL. Útil para análises pontuais sem abrir o navegador.

Tudo que é **decoder** e **SDK** mora nos repos linkados acima — este
repo consome `@precisa-saude/datasus-dbc@^2.0.0` e
`@precisa-saude/datasus-sdk@^2.0.1` via npm.

## Instalação da CLI

```bash
npm install -g @precisa-saude/datasus-cli
datasus-brasil --help
```

A CLI conserva o nome histórico `datasus-brasil` para evitar quebrar
scripts existentes.

## Site de visualização

Produção: URL pública a ser anunciada quando o deploy da Fase 2 entrar no ar.

Dev local:

```bash
pnpm install
pnpm -F @datasus-viz/site dev
```

Veja [`packages/site/docs/`](packages/site/docs/) para arquitetura,
pipeline de dados e deployment.

## Uso rápido da CLI

### Help

```bash
datasus-brasil --help
```

### SIA-PA (produção ambulatorial)

```bash
# Top 10 procedimentos em laboratório com LOINC, em AC, jan/2024
datasus-brasil sia --uf AC --year 2024 --month 1 --laboratory --enrich-loinc --top 10
```

### CNES-ST (cadastro de estabelecimentos)

```bash
datasus-brasil cnes --uf AC --year 2024 --month 1 --top 5
```

Todas as flags e formatos em [`packages/cli/README.md`](packages/cli/README.md).

## Cache de microdata

A CLI e o site (via SDK) reutilizam cache local de arquivos DBC:

- `$XDG_CACHE_HOME/datasus-brasil/...` (ou `~/.cache/datasus-brasil/...`)
- Estrutura idêntica ao FTP oficial; reexecuções hitam cache sem rede.

## Licença

Apache-2.0 (código). Ver [LICENSE](LICENSE).

Dados agregados publicados (quando aplicável) seguem CC-BY 4.0, derivados
dos microdados DATASUS sob regime de dados abertos (Lei 12.527/2011 +
Decreto 8.777/2016). Detalhes em
[`packages/site/docs/data-license.md`](packages/site/docs/data-license.md).
