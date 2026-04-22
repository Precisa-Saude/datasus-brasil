# datasus-brasil

Toolkit TypeScript/JavaScript para microdados abertos do DATASUS — decoder **puro JS** do formato `.dbc`, cliente FTP com cache, schemas tipados e labeling.

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

## Uso — CLI

Stdout recebe JSON/JSONL; stderr recebe barra de progresso e logs — pronto pra pipe direto em `jq`.

### Help e versão

```bash
datasus-brasil --help
```

```
datasus-brasil — CLI para microdados DATASUS

Uso:
  datasus-brasil <comando> [flags]

Comandos:
  cnes     Top tipos de estabelecimento de saúde (CNES-ST).

Globais:
  -h, --help        Mostra esta ajuda (ou ajuda do comando).
  -v, --version     Mostra a versão.

Flags de subset (todos os comandos):
  --limit N    Para a leitura após N registros (bom pra smoke test).
  --labeled    Emite cada registro decodificado em pt-BR (JSONL default).
  --raw        Emite registros brutos do DATASUS (JSONL default).

Exemplos:
  datasus-brasil cnes --uf AC --year 2024 --month 1
  datasus-brasil cnes --uf AC --year 2024 --month 1 --labeled --limit 3
  datasus-brasil cnes --uf SP --year 2024 --month 1 --raw --format jsonl

Ver '<comando> --help' para detalhes de cada comando.
```

```bash
datasus-brasil --version
# → 0.1.0
```

### `cnes` — default (agregação top-N)

Sem flags, retorna os tipos de unidade mais frequentes com rótulo pt-BR:

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

Com `--format jsonl`, a mesma agregação sai uma linha por entrada:

```bash
datasus-brasil cnes --uf AC --year 2024 --month 1 --top 3 --format jsonl
```

```
{"count":521,"key":"Pronto Socorro Especializado"}
{"count":226,"key":"Centro de Saúde / Unidade Básica"}
{"count":171,"key":"Clínica / Centro de Especialidade"}
```

### `cnes --labeled` — estabelecimentos decodificados em pt-BR

Projeta cada registro via `labelEstabelecimento`, decodificando os 150+ campos DATASUS num objeto enxuto:

```bash
datasus-brasil cnes --uf AC --year 2024 --month 1 --labeled --limit 1 --format json
```

```json
[
  {
    "atendimentos": [
      "Atende pré-natal",
      "Atende ambulatorial",
      "Possui coleta de resíduos",
      "Gera resíduos biológicos",
      "Gera resíduos químicos"
    ],
    "atividadeEnsino": { "codigo": "04", "rotulo": "Hospital auxiliar de ensino" },
    "clientela": { "codigo": "01", "rotulo": "Atendimento exclusivo SUS" },
    "cnes": "0153281",
    "cnpj": "84306737000127",
    "competencia": "2024-01",
    "gestao": { "codigo": "M", "rotulo": "Municipal" },
    "instalacoes": [
      { "codigo": "QTINST15", "quantidade": 1, "rotulo": "Consultórios indiferenciados" },
      { "codigo": "QTINST25", "quantidade": 1, "rotulo": "Salas de reidratação" }
    ],
    "leitos": { "porEspecialidade": [], "total": 0 },
    "matrizAtividadeConvenio": [
      {
        "atividade": "AP02",
        "atividadeRotulo": "Média complexidade",
        "convenio": "CV01",
        "convenioRotulo": "SUS"
      }
    ],
    "municipio": { "codigo": "120001", "nome": "Acrelândia", "uf": "AC" },
    "naturezaJuridica": { "codigo": "1244", "rotulo": "Município (administração direta)" },
    "nivelAtencaoAmbulatorial": { "codigo": "1", "rotulo": "Atenção básica" },
    "tipo": { "codigo": "70", "rotulo": "Centro de Atenção Psicossocial" },
    "turno": { "codigo": "03", "rotulo": "Noite" },
    "vinculoSUS": { "codigo": "1", "rotulo": "Vinculada ao SUS" }
  }
]
```

Sem `--format`, default vira JSONL (streaming-friendly, memória constante):

```bash
datasus-brasil cnes --uf AC --year 2024 --month 1 --labeled --limit 2
```

```
{"atendimentos":[...],"cnes":"0153281","tipo":{"codigo":"70","rotulo":"Centro de Atenção Psicossocial"},...}
{"atendimentos":[...],"cnes":"0257184","tipo":{"codigo":"02","rotulo":"Centro de Saúde / Unidade Básica"},...}
```

### `cnes --raw` — registros brutos do DATASUS

Emite cada registro cru, preservando nomes de coluna DATASUS (150+ campos). Útil pra inspecionar schema ou alimentar pipelines externos:

```bash
datasus-brasil cnes --uf AC --year 2024 --month 1 --raw --limit 1 --format jsonl
```

```jsonc
// uma linha JSONL (reformatado para leitura):
{
  "CNES": "0153281",
  "CODUFMUN": "120001",
  "PF_PJ": "3",
  "NIV_DEP": "3",
  "CNPJ_MAN": "84306737000127",
  "VINC_SUS": "1",
  "TPGESTAO": "M",
  "CLIENTEL": "01",
  "TP_UNID": "70",
  "TURNO_AT": "03",
  "NAT_JUR": "1244",
  "QTINST15": 1,
  "QTINST25": 1,
  "SERAP01T": "0",
  "AP02CV01": "1",
  "COMPETEN": "202401",
  // ...150+ campos no total
}
```

`--raw` é mutuamente exclusivo com `--labeled`.

### Pipes com `jq`

```bash
# só o tipo top
datasus-brasil cnes --uf SP --year 2024 --month 1 --top 1 | jq '.[0]'

# contagem por gestão a partir do raw
datasus-brasil cnes --uf AC --year 2024 --month 1 --raw --format jsonl --limit 200 \
  | jq -s 'group_by(.TPGESTAO) | map({gestao: .[0].TPGESTAO, count: length})'
```

```json
[
  { "gestao": "E", "count": 52 },
  { "gestao": "M", "count": 148 }
]
```

```bash
# filtrar por município específico no modo labeled
datasus-brasil cnes --uf SP --year 2024 --month 1 --labeled \
  | jq -c 'select(.municipio.nome == "Santo André") | {cnes, tipo: .tipo.rotulo}'
```

### Smoke test end-to-end

[`examples/cnes-smoke-test.sh`](examples/cnes-smoke-test.sh) exercita os três modos contra o FTP DATASUS real — útil como verificação de release:

```bash
pnpm turbo run build
examples/cnes-smoke-test.sh AC 2024 1
```

### Cache e progresso

- Downloads caem em `$XDG_CACHE_HOME/datasus-brasil` (ou `~/.cache/datasus-brasil`), estrutura de diretórios idêntica ao FTP. Reexecuções batem cache sem refazer download.
- Em TTY: barra interativa em stderr com %, bytes, velocidade. Em pipe/log: uma linha-resumo no final.

## Uso — biblioteca

### CNES streaming + labeling

```ts
import { cnes, labelEstabelecimento } from '@precisa-saude/datasus';

// Streaming — memória constante mesmo em UFs grandes
for await (const record of cnes.streamEstabelecimentos({ uf: 'AC', year: 2024, month: 1 })) {
  const est = labelEstabelecimento(record);
  console.log(est.tipo.rotulo, est.municipio.nome, est.leitos.total);
}

// Carregar tudo em memória (útil pra agregações)
const todos = await cnes.loadEstabelecimentos({ uf: 'AC', year: 2024, month: 1 });
```

### Terminologia LOINC ↔ TUSS ↔ SIGTAP

```ts
import { listBiomarkers, loincToSigtap, lookupSigtap, lookupTuss } from '@precisa-saude/datasus';

// Biomarcador do @precisa-saude/fhir → procedimento SUS
const m = loincToSigtap('2085-9'); // Colesterol HDL
// → {
//     loinc: '2085-9',
//     biomarker: { code: 'HDL', display: 'Colesterol HDL' },
//     sigtap: '0202010279',
//     tuss: '40301583',
//     confidence: 'high',
//     source: 'llm-refined',
//     reasoning: '...',
//     noMatchReason: null
//   }

lookupSigtap(m!.sigtap!);
// → { code: '0202010279', name: 'DOSAGEM DE COLESTEROL HDL' }

lookupTuss(m!.tuss!);
// → { code: '40301583', name: 'Colesterol (HDL) — pesquisa e/ou dosagem',
//     sigtapEquivalents: [{ code: '0202010279', name: '...', equivalencia: '3' }] }

// Aceita também o código curto do biomarcador
loincToSigtap('HDL')?.loinc; // '2085-9'

// Percorrer os 164 biomarcadores do catálogo
for (const entry of listBiomarkers()) {
  // ...
}
```

### Agregações e utilities

```ts
import { countBy, countByNested, findMunicipio, topN } from '@precisa-saude/datasus';

const records = await cnes.loadEstabelecimentos({ uf: 'AC', year: 2024, month: 1 });

// Top-10 municípios por quantidade de estabelecimentos
const counts = countBy(records, (r) => r.CODUFMUN);
const top10 = topN(counts, 10).map(({ count, key }) => {
  const m = findMunicipio(key);
  return { estabelecimentos: count, municipio: m?.nome, uf: m?.uf };
});

// Breakdown aninhado: tipo × gestão
const matriz = countByNested(records, (r) => [r.TP_UNID ?? '?', r.TPGESTAO ?? '?']);
```

### FTP client low-level

```ts
import { download, type ProgressEvent } from '@precisa-saude/datasus';

const bytes = await download({
  path: '/dissemin/publicos/CNES/200508_/Dados/ST/STAC2401.dbc',
  onProgress: (e: ProgressEvent) => {
    if (e.fromCache) console.log('cache hit');
    else console.log(`${e.transferred}/${e.total ?? '?'}`);
  },
});
```

### Decoder DBC puro (browser + Node)

```ts
import { readDbcRecords } from '@precisa-saude/datasus-dbc';

// De um ArrayBuffer (browser: fetch, Node: readFile)
const response = await fetch('https://.../STAC2401.dbc');
const bytes = new Uint8Array(await response.arrayBuffer());

for await (const record of readDbcRecords(bytes)) {
  // record é um objeto JS com os campos DBF decodificados
}
```

## Datasets

**Atual:** CNES (Cadastro Nacional de Estabelecimentos de Saúde).

**Roadmap:** SIA-SUS (Sistema de Informações Ambulatoriais) — o dataset aderente a plataformas de acompanhamento de biomarcadores, porque contém todos os exames laboratoriais faturados pelo SUS via códigos **SIGTAP**.

## Terminologia LOINC ↔ TUSS ↔ SIGTAP

Pra ligar biomarcadores LOINC (usados no produto via `@precisa-saude/fhir`) aos códigos SIGTAP necessários pra consultar o SIA-SUS, o pacote `@precisa-saude/datasus` expõe uma **API programática** (`loincToSigtap`, `lookupSigtap`, `lookupTuss`, `listBiomarkers`) com as tabelas embutidas:

- **Tabela oficial TUSS ↔ SIGTAP** — publicada pela ANS em parceria com COPISS e MS (2015-2017, baseada em ISO/TR 12300:2014). 6919 linhas com grau de equivalência 1-5.
  - Download: [padraotiss_mapeamento_tuss_sigtap.zip](https://www.gov.br/ans/pt-br/arquivos/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-tiss/padrao-tiss-tabelas-relacionadas/padraotiss_mapeamento_tuss_sigtap.zip) · [página de origem](https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-tabelas-relacionadas)
- **Tabela SIGTAP (Procedimentos SUS)** — publicada mensalmente pelo DATASUS em [sigtap.datasus.gov.br](http://sigtap.datasus.gov.br/).
- **Biomarcadores LOINC** — 164 biomarcadores do `@precisa-saude/fhir`, mapeados via fuzzy matching e refinados por LLM (Gemini 3.1 Pro) pra resolver colisões semânticas.

Scripts de regeneração (one-shot quando a ANS/DATASUS publicar nova competência) em [`packages/core/scripts/`](packages/core/scripts/). Ver [`packages/core/README.md`](packages/core/README.md) pra exemplos de uso e comandos.

## Licença

[Apache-2.0](LICENSE). Dados microdata são públicos (Lei de Acesso à Informação); esta biblioteca apenas decodifica e normaliza.

## Aviso

Ver [DISCLAIMER.md](DISCLAIMER.md). Software para uso informativo, educacional e de pesquisa — não substitui análise epidemiológica profissional ou decisões clínicas.
