# @precisa-saude/datasus-cli

CLI para microdados DATASUS — download, decodificação e agregação com saída JSON (default) ou JSONL.

> 🚧 Em desenvolvimento — ver [PRE-198](https://linear.app/precisa-saude/issue/PRE-198).

## Comandos

```bash
datasus-brasil cnes --uf <UF> --year <YYYY> --month <MM> [--top N] [--limit N] [--raw] [--format json|jsonl]
```

Use `datasus-brasil <comando> --help` para detalhes de cada comando.

**Flags de subset** (todos os comandos):

- `--limit N` — para a leitura após N registros. Essencial pra smoke test em datasets grandes. Como arquivos DATASUS frequentemente vêm ordenados por UF/data, `--limit` combinado com agregação não é estatisticamente representativo — use pra exploração.
- `--raw` — emite registros brutos em vez da agregação. Sem `--format` explícito, defaulta pra JSONL (streaming-friendly, memória constante).

## Testar localmente

A partir da raiz do monorepo:

```bash
pnpm install
pnpm turbo run build --filter=@precisa-saude/datasus-cli

# direto pelo bin compilado
node packages/cli/dist/index.js cnes --uf AC --year 2024 --month 1

# via pnpm exec (usa a bin registrada no workspace)
pnpm exec datasus-brasil cnes --uf AC --year 2024 --month 1

# modo dev (tsx, sem build)
pnpm -F @precisa-saude/datasus-cli dev cnes --uf AC --year 2024 --month 1
```

Para linkar globalmente (opcional):

```bash
pnpm -F @precisa-saude/datasus-cli link --global
datasus-brasil --help
```

## Saída

JSON-first. Stdout recebe o resultado, stderr recebe progresso de download (barra ao vivo em TTY, linha-resumo em pipe) e logs — permitindo pipe direto para `jq` e amigos.

### CNES — top tipos de estabelecimento

`datasus-brasil cnes --uf AC --year 2024 --month 1 --top 5` agrega por `TP_UNID` com label pt-BR:

```json
[
  { "count": 521, "key": "Pronto Socorro Especializado" },
  { "count": 226, "key": "Centro de Saúde / Unidade Básica" },
  { "count": 171, "key": "Clínica / Centro de Especialidade" },
  { "count": 76, "key": "Unidade de Apoio Diagnose e Terapia (SADT Isolado)" },
  { "count": 73, "key": "Farmácia" }
]
```

### JSONL — uma linha por registro

`datasus-brasil cnes --uf AC --year 2024 --month 1 --top 3 --format jsonl`:

```
{"count":521,"key":"Pronto Socorro Especializado"}
{"count":226,"key":"Centro de Saúde / Unidade Básica"}
{"count":171,"key":"Clínica / Centro de Especialidade"}
```

### `--raw` — registros brutos

`datasus-brasil cnes --uf AC --year 2024 --month 1 --raw --limit 1` emite cada registro CNES-ST completo como JSONL (uma linha, ~80 campos). Usa-se pra inspecionar schema ou alimentar pipelines externos.

### Pipeline com `jq`

```bash
# só o estabelecimento top
datasus-brasil cnes --uf SP --year 2024 --month 1 | jq '.[0]'

# filtrar CNES-ST por tipo específico em streaming
datasus-brasil cnes --uf SP --year 2024 --month 1 --raw \
  | jq -c 'select(.TP_UNID == "01") | {cnes: .CNES, nome: .FANTASIA}'
```

## Progresso de download

Em TTY: barra interativa com %, bytes transferidos/total e velocidade — redesenhada in-place:

```
CNES-ST SP/2024/03 [████████░░░░░░░░░░░░░░░░]  35%  6.0 MB / 17.0 MB  4.2 MB/s
```

Em pipe/log (não-TTY): uma linha-resumo ao final, evitando ruído em arquivos:

```
CNES-ST SP/2024/03 17.0 MB em 4.1s (4.2 MB/s)
```

Cache hit (arquivo já baixado): uma linha única e imediata:

```
CNES-ST AC/2024/01 (cache, 60.6 KB)
```

O cache mora em `$XDG_CACHE_HOME/datasus-brasil` (ou `~/.cache/datasus-brasil` como fallback), preservando a estrutura do FTP. Para forçar re-download, apague o arquivo.
