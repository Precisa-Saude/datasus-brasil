# datasus-brasil

Toolkit TypeScript/JavaScript para microdados abertos do DATASUS — decoder **puro JS** do formato `.dbc`, cliente FTP com cache, schemas tipados por vintage e labeling (CID-10, IBGE, CBO, SIGTAP).

> 🚧 **Em desenvolvimento** — pacotes ainda não publicados no npm. MVP previsto: SIH, SINAN, CNES.

## Motivação

DATASUS publica milhões de registros por mês (internações, notificações compulsórias, cadastro de estabelecimentos) em `.dbc` — um formato dos anos 90 (xBase DBF comprimido com PKWARE DCL Implode), sem spec oficial, distribuído via FTP.

Hoje o ecossistema é dominado por R (`microdatasus`, `read.dbc`) e Python (`PySUS`, `datasus-dbc`). **JS/TS não tem nada viável**: o único pacote npm existente é native-addon C++ com licença AGPLv3.

`datasus-brasil` preenche essa lacuna com um toolkit moderno TS/JS — browser e Node compatíveis, licença permissiva (Apache-2.0), zero dependências nativas.

## Pacotes

| Pacote                       | Descrição                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `@precisa-saude/datasus-dbc` | Decoder puro TS/JS de arquivos DBC (DCL Implode + xBase DBF) — browser + Node |
| `@precisa-saude/datasus`     | Façade alto-nível: FTP cliente, schemas por vintage, labeling, agregações     |

## Uso (preview)

```ts
import { sih } from '@precisa-saude/datasus';

const admissions = await sih.load({
  uf: 'SP',
  year: 2024,
  month: 3,
});

// Top 10 CID por município, como JSON pronto para web app ou CLI
console.log(JSON.stringify(admissions.topCidByMunicipio(10), null, 2));
```

## Datasets no MVP

- **SIH-RD** — Autorização de Internação Hospitalar (reduzida), mensal por UF
- **SINAN** — Agravos de notificação (dengue, chikungunya, zika)
- **CNES** — Cadastro Nacional de Estabelecimentos de Saúde

Outros datasets (SIM, SINASC, SIA, PNI) ficam para fases posteriores.

## Licença

[Apache-2.0](LICENSE). Dados microdata são públicos (Lei de Acesso à Informação); esta biblioteca apenas decodifica e normaliza.

## Aviso

Ver [DISCLAIMER.md](DISCLAIMER.md). Software para uso informativo, educacional e de pesquisa — não substitui análise epidemiológica profissional ou decisões clínicas.
