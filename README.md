# datasus-brasil

Toolkit TypeScript/JavaScript para microdados abertos do DATASUS — decoder **puro JS** do formato `.dbc`, cliente FTP com cache, schemas tipados e labeling.

> 🚧 **Em desenvolvimento** — pacotes ainda não publicados no npm.

## Motivação

DATASUS publica milhões de registros por mês (cadastro de estabelecimentos, produção ambulatorial, etc.) em `.dbc` — um formato dos anos 90 (xBase DBF comprimido com PKWARE DCL Implode), sem spec oficial, distribuído via FTP.

Hoje o ecossistema é dominado por R (`microdatasus`, `read.dbc`) e Python (`PySUS`, `datasus-dbc`). **JS/TS não tem nada viável**: o único pacote npm existente é native-addon C++ com licença AGPLv3.

`datasus-brasil` preenche essa lacuna com um toolkit moderno TS/JS — browser e Node compatíveis, licença permissiva (Apache-2.0), zero dependências nativas.

## Pacotes

| Pacote                       | Descrição                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `@precisa-saude/datasus-dbc` | Decoder puro TS/JS de arquivos DBC (DCL Implode + xBase DBF) — browser + Node |
| `@precisa-saude/datasus`     | Façade alto-nível: FTP cliente, schemas, labeling, agregações                 |
| `@precisa-saude/datasus-cli` | CLI `datasus-brasil` para exploração e extração ad-hoc — saída JSON/JSONL     |

## Uso

### Via CLI

```bash
datasus-brasil cnes --uf AC --year 2024 --month 1 --top 3
```

```json
[
  { "count": 521, "key": "Pronto Socorro Especializado" },
  { "count": 226, "key": "Centro de Saúde / Unidade Básica" },
  { "count": 171, "key": "Clínica / Centro de Especialidade" }
]
```

Flags `--raw` (registros brutos JSONL) e `--limit N` (para cedo) disponíveis. Ver [`packages/cli/README.md`](packages/cli/README.md) para exemplos completos de saída.

### Via biblioteca

```ts
import { cnes, countBy, findMunicipio, topN } from '@precisa-saude/datasus';

// Streaming — memória constante
const counts: Record<string, number> = {};
for await (const record of cnes.streamEstabelecimentos({ uf: 'SP', year: 2024, month: 3 })) {
  counts[record.CODUFMUN] = (counts[record.CODUFMUN] ?? 0) + 1;
}

const top10 = topN(counts, 10).map(({ count, key }) => {
  const m = findMunicipio(key);
  return { estabelecimentos: count, municipio: m?.nome, uf: m?.uf };
});

console.log(JSON.stringify(top10, null, 2));
```

## Datasets

**Atual:** CNES (Cadastro Nacional de Estabelecimentos de Saúde).

**Roadmap:** SIA-SUS (Sistema de Informações Ambulatoriais) — o dataset aderente a plataformas de acompanhamento de biomarcadores, porque contém todos os exames laboratoriais faturados pelo SUS via códigos **SIGTAP**.

## Terminologia LOINC ↔ TUSS ↔ SIGTAP

Pra ligar biomarcadores LOINC (usados no produto via `@precisa-saude/fhir`) aos códigos SIGTAP necessários pra consultar o SIA-SUS, o pacote `@precisa-saude/datasus` inclui dados derivados em [`packages/core/data/`](packages/core/data/), construídos a partir de fontes oficiais:

- **Tabela oficial TUSS ↔ SIGTAP** — publicada pela ANS em parceria com COPISS e MS (2015-2017, baseada em ISO/TR 12300:2014). 6919 linhas com grau de equivalência 1-5.
  - Download: [padraotiss_mapeamento_tuss_sigtap.zip](https://www.gov.br/ans/pt-br/arquivos/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-tiss/padrao-tiss-tabelas-relacionadas/padraotiss_mapeamento_tuss_sigtap.zip) · [página de origem](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-tabelas-relacionadas)
- **Tabela SIGTAP (Procedimentos SUS)** — publicada mensalmente pelo DATASUS em [sigtap.datasus.gov.br](http://sigtap.datasus.gov.br/).

Scripts de extração e construção do mapeamento derivado estão em [`packages/core/scripts/`](packages/core/scripts/) — TypeScript puro, sem dependências externas. Ver [`packages/core/README.md`](packages/core/README.md) para detalhes e comandos de regeneração.

## Licença

[Apache-2.0](LICENSE). Dados microdata são públicos (Lei de Acesso à Informação); esta biblioteca apenas decodifica e normaliza.

## Aviso

Ver [DISCLAIMER.md](DISCLAIMER.md). Software para uso informativo, educacional e de pesquisa — não substitui análise epidemiológica profissional ou decisões clínicas.
