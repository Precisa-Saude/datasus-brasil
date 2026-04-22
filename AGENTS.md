# Specific instructions — datasus-brasil

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

TypeScript/JavaScript toolkit for DATASUS open microdata. Powers the
"dados em contexto populacional" feature on the Precisa Saúde platform.

Plan references: Linear **PRE-198** (parent: PRE-197).

## Structure

```
packages/
  dbc/     → @precisa-saude/datasus-dbc  (PKWARE DCL Implode + xBase DBF decoder, pure TS)
  core/    → @precisa-saude/datasus      (façade, FTP, schemas, labeling)
  cli/     → internal CLI (not published)
```

## Commit scopes

Valid scopes: `dbc`, `core`, `cli`, `docs`, `ci`, `deps`, `lint`, `config`.

## Data output — JSON-first

**CRITICAL**: user-visible output (examples, CLI, end-to-end checks,
README snippets) defaults to **JSON**, with **JSONL** for streaming.
CSV is not the default — available only as opt-in via `--format csv`.
Parquet/Arrow are storage/cache options, not primary output.

## Dependency rules

- `@precisa-saude/datasus-dbc` has `dbffile` as its only runtime dep
- `@precisa-saude/datasus` may depend on `dbffile`, `basic-ftp`,
  `@precisa-saude/datasus-dbc`, `@precisa-saude/fhir`
- No native dependencies (node-gyp, prebuild) — enforced baseline for
  this repo
- Any other runtime dep requires explicit approval

## Vintage and schema

DATASUS microdata schemas change across vintages (e.g. SIH-RD 2008 ≠
2024). When a vintage differs, declare the applied schema explicitly
in logs and docs — never apply silent transformations between schemas.

## Worktree — specific values

Worktree flow and commands are in the shared base. The canonical config
lives in `package.json` under `"worktree"`. For quick reference:

| Field         | Value                                     |
| ------------- | ----------------------------------------- |
| Port registry | `/tmp/datasus-brasil-worktree-ports.json` |
| Main port     | `site=4322`                               |
| Feature base  | `site=4332`, increment 10                 |
| pnpm filter   | `@datasus-brasil/site`                    |

The site (`site/`) isn't scaffolded yet, so the port is reserved but
`dev` is a no-op. Once the frontend lands, the same CLI commands
(`setup`/`dev`/`stop`/`teardown`) will work without config changes.
