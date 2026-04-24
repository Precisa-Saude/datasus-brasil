# Specific instructions — datasus-viz

> This file holds ONLY the rules specific to this repository. The
> shared rules across the precisa-saude ecosystem (tone, git,
> hooks, reviews, worktrees, source verification, test coverage, code
> conventions) live in `@precisa-saude/agent-instructions`.
>
> **Read the shared base online:**
> https://github.com/Precisa-Saude/tooling/blob/main/packages/agent-instructions/AGENTS.md
>
> Claude Code loads both files (shared base + this one) via imports in
> `CLAUDE.md`. Update the base with:
> `pnpm update @precisa-saude/agent-instructions`.

## Overview

Geo-visualização (site + CLI) de microdados DATASUS. Consumer repo do
ecossistema open-source da Precisa Saúde. Decoder e SDK vivem em repos
separados — ver README.

## Structure

```
packages/
  cli/     → @precisa-saude/datasus-cli   (CLI `datasus-brasil`, consome datasus-sdk via npm)
  site/    → @datasus-viz/site            (Vite + React + MapLibre + DuckDB WASM)
```

Decoder e SDK extraídos para:

- `datasus-dbc` → `@precisa-saude/datasus-dbc`
- `datasus-sdk` → `@precisa-saude/datasus-sdk` (era `@precisa-saude/datasus`)

## Commit scopes

Valid scopes: `site`, `cli`, `docs`, `ci`, `deps`, `lint`, `config`.

## Data output — JSON-first

**CRITICAL**: user-visible output (examples, CLI, end-to-end checks,
README snippets) defaults to **JSON**, with **JSONL** for streaming.
CSV is not the default — available only as opt-in via `--format csv`.
Parquet/Arrow are storage/cache options, not primary output.

## Dependency rules

- CLI depende apenas de `@precisa-saude/datasus-sdk@^2.0.1` via npm (não workspace)
- Site depende de `@precisa-saude/datasus-sdk`, `@precisa-saude/datasus-dbc`, DuckDB WASM, MapLibre GL JS, PMTiles
- No native dependencies (node-gyp, prebuild) fora das que já existem (duckdb) — enforced baseline
- Any other runtime dep requires explicit approval

## Vintage and schema

DATASUS microdata schemas change across vintages (e.g. SIH-RD 2008 ≠
2024). When a vintage differs, declare the applied schema explicitly
in logs and docs — never apply silent transformations between schemas.

## Worktree — specific values

Worktree flow and commands are in the shared base. The canonical config
lives in `package.json` under `"worktree"`. For quick reference:

| Field         | Value                                  |
| ------------- | -------------------------------------- |
| Port registry | `/tmp/datasus-viz-worktree-ports.json` |
| Main port     | `site=4322`                            |
| Feature base  | `site=4332`, increment 10              |
| pnpm filter   | `@datasus-viz/site`                    |

O site está em `main` e é servido normalmente via `pnpm -F @datasus-viz/site dev`.
