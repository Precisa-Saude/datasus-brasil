# Convenções

## Idioma

- **Documentação, README, commits, comentários voltados ao usuário**: pt-BR com acentuação correta
- **Identificadores técnicos** (nomes de funções, tipos, variáveis, pacotes): inglês técnico
- Arquivos padrão (`LICENSE`, `CODE_OF_CONDUCT.md`) mantêm o formato upstream

## TypeScript

- **Strict mode** com `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- **ESM + CJS dual output** via tsup
- Evitar `any`; usar `unknown` + narrow quando necessário
- Preferir `type-only imports` (`import type { Foo }`)
- Funções públicas: documentar com JSDoc breve explicando _o quê_ e (quando não óbvio) _por quê_

## Saída de dados — JSON-first

- APIs retornam **objetos JS tipados** (arrays ou async iterables)
- Serialização default: **JSON** (single-shot) ou **JSONL** (streaming / datasets grandes)
- CSV **não é default** — disponível apenas como opção explícita (`--format csv`)
- Parquet/Arrow são formatos de **armazenamento/cache** opcionais, não saída primária
- Todo exemplo, script de verificação, snippet de README e output de CLI sai em JSON por padrão

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/)
- Em **pt-BR** na descrição; tipo (`feat`, `fix`, etc.) em inglês
- Escopos válidos: `dbc`, `core`, `cli`, `docs`, `ci`, `deps`, `lint`, `config`
- Não incluir linhas de atribuição de IA

Exemplos:

- `feat(dbc): adicionar parser do header DBC`
- `fix(core): corrigir encoding latin1 em campos com acentos`
- `test(dbc): adicionar fixtures para testes de regressão`
- `docs: atualizar README com exemplo de uso`

## Testes

- **Vitest** com limiar de cobertura ≥ 80%
- Golden files / fixtures de referência em JSON
- Nunca diminuir limiares de cobertura — adicionar testes para elevar

## Dependências

**Perguntar antes de adicionar** dependências runtime novas. Justificar por quê e qual alternativa foi considerada.

Regras por pacote:

- `@precisa-saude/datasus-dbc`: apenas `dbffile` como dep runtime
- `@precisa-saude/datasus`: `dbffile`, `basic-ftp`, `@precisa-saude/datasus-dbc`. Opcionalmente `@precisa-saude/fhir` para reuso de CID/LOINC.

## Git

- Sempre criar PR, nunca push direto em `main`
- Nunca usar `--no-verify`, `--no-gpg-sign` ou flags que pulem hooks
- `git pull --rebase origin main` para manter histórico linear
- Commits assinados com GPG (`commit.gpgsign=true`)

## Fontes Proibidas

Ao documentar schemas ou labeling:

**Proibidas**:

- Blogs comerciais ou portais não-acadêmicos
- Páginas iniciais genéricas (use URLs de documentos específicos)

**Aceitáveis** (nesta ordem):

1. Documentação oficial DATASUS/Ministério da Saúde
2. Tabelas IBGE e portarias publicadas no DOU
3. Artigos PubMed/SciELO com DOI ou PMID
4. Publicações técnicas de sociedades médicas com referência verificável
