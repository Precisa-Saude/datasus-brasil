# Instruções para o Claude

NÃO use "You're absolutely right" ou equivalentes. Mantenha um tom profissional e positivo sem entusiasmo desnecessário.

## Português Brasileiro Correto

**CRÍTICO**: Toda documentação, mensagens de commit e texto voltado ao usuário devem usar pt-BR com acentuação correta. Nunca omita acentos — isso é visualmente errado e passa uma impressão de descuido.

**Errado**: `definicoes`, `referencia`, `codigo`, `clinica`, `Instalacao`, `rapido`
**Correto**: `definições`, `referência`, `código`, `clínica`, `Instalação`, `rápido`

## Visão Geral do Projeto

`datasus-brasil` — toolkit TS/JS para microdados abertos do DATASUS. Alimenta a feature "dados em contexto populacional" na plataforma Precisa Saúde.

Referências de plano e execução: ver Linear **PRE-198** (parent: PRE-197).

## Estrutura do Monorepo

```
packages/
  dbc/     → @precisa-saude/datasus-dbc  (decoder PKWARE DCL Implode + xBase DBF, pure TS)
  core/    → @precisa-saude/datasus      (façade, FTP, schemas, labeling)
```

## Comandos

```bash
pnpm install
pnpm turbo run build
pnpm turbo run typecheck
pnpm turbo run lint
pnpm turbo run test
pnpm turbo run test:coverage
```

## Convenções

- **TypeScript strict** com `noUncheckedIndexedAccess`
- **ESM + CJS dual** via tsup
- **Vitest** para testes, limiar de cobertura 80%
- **Zero dependências nativas** (sem native addons, sem WASM)
- **pt-BR correto** em docs/commits, identificadores em inglês técnico
- Mensagens de commit: `tipo(escopo): descrição`, escopos válidos: `dbc`, `core`, `cli`, `docs`, `ci`, `deps`, `lint`, `config`

## Saída de Dados — JSON-first

**CRÍTICO**: toda saída visível ao usuário (exemplos, CLI, verificações end-to-end, snippets de README) deve usar **JSON como default** e **JSONL** para streaming. CSV não é padrão — disponível apenas como opção opt-in (`--format csv`). Parquet/Arrow são opções de armazenamento/cache, não saída primária.

## Adicionar Novas Dependências

**Sempre perguntar antes de adicionar dependências npm.** Forneça uma breve descrição do que o pacote faz e por que é necessário.

**Regras de dependência**:

- `@precisa-saude/datasus-dbc` deve ter apenas `dbffile` como dependência runtime
- `@precisa-saude/datasus` pode depender de `dbffile`, `basic-ftp`, `@precisa-saude/datasus-dbc`, `@precisa-saude/fhir`
- Nada de dependências nativas (node-gyp, prebuild)
- Pergunte antes de adicionar qualquer outra dependência runtime

## Commits Requerem Permissão

**CRÍTICO**: Sempre peça permissão antes de criar commits. Nunca faça commit sem aprovação explícita do usuário.

Ao criar commits, **NÃO inclua linhas de atribuição de IA** (`Co-Authored-By: Claude`, `Generated with Claude`, etc.). O hook de commit-msg bloqueia esses padrões.

## Sempre Usar Pull Requests

**CRÍTICO**: Nunca faça push direto na main. Sempre crie um pull request para code review.

**Fluxo**:

1. Criar branch de feature a partir da main
2. Fazer commits na branch de feature
3. Fazer push da branch e abrir um PR
4. Merge via GitHub após revisão

## Nunca Pular Git Hooks

**CRÍTICO**: Nunca use `--no-verify`, `--no-gpg-sign`, ou qualquer flag que pule git hooks. Se um hook falhar, **corrija o problema subjacente** em vez de contornar.

## Diretrizes de Commits Git

**CRÍTICO**: Sempre faça pull antes de commitar:

```bash
git pull --rebase origin main
```

Mensagens em pt-BR. Exemplos:

- `feat(dbc): adicionar parser do header DBC`
- `fix(core): corrigir decoding de datas em CNES`
- `test(dbc): adicionar fixtures de regressão`
- `docs: atualizar README com exemplo de agregação`

## Integridade dos Dados

Microdados DATASUS são a fonte de verdade. Não inventar valores, não aplicar transformações silenciosas. Quando uma vintage difere de schema entre anos, declarar explicitamente o schema aplicado.

## Worktrees para Sessões Paralelas

Usar `scripts/worktree.sh` quando houver chance de sessões concorrentes. Um worktree por feature, nunca trabalhar direto na main se houver outra sessão viva.

```bash
./scripts/worktree.sh setup feat/nova-feature
cd ../datasus-brasil-feat-nova-feature
./scripts/worktree.sh teardown feat/nova-feature   # após merge
```
