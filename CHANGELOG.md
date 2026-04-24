## [1.2.0](https://github.com/Precisa-Saude/datasus-viz/compare/v1.1.0...v1.2.0) (2026-04-24)

### Features

* **site:** geo-visualização de biomarcadores com Mapbox + SIA-PA ([#10](https://github.com/Precisa-Saude/datasus-viz/issues/10)) ([1f632ed](https://github.com/Precisa-Saude/datasus-viz/commit/1f632ede79c7c3ed4a465d81b3e8e9047fccaa18)), closes [#f3f0ff](https://github.com/Precisa-Saude/datasus-viz/issues/f3f0ff)

### Chores

* cleanup pós-split — remover packages extraídos + rename pra datasus-viz ([#11](https://github.com/Precisa-Saude/datasus-viz/issues/11)) ([495b695](https://github.com/Precisa-Saude/datasus-viz/commit/495b695c50d6dc9e0e465908d4ab59537c27e832))

## [1.1.0](https://github.com/Precisa-Saude/datasus-brasil/compare/v1.0.0...v1.1.0) (2026-04-23)

### Features

* SIA-SUS (PA) — dataset, bridge SIGTAP→LOINC e CLI ([#9](https://github.com/Precisa-Saude/datasus-brasil/issues/9)) ([4fb88e9](https://github.com/Precisa-Saude/datasus-brasil/commit/4fb88e95b84b1aa75bf20e56e51e85ca94997b13))

### Chores

* **deps:** bump @precisa-saude/* para ^1.5.0 ([#8](https://github.com/Precisa-Saude/datasus-brasil/issues/8)) ([1543d6e](https://github.com/Precisa-Saude/datasus-brasil/commit/1543d6e3cc1af689352eef6c90f40b2af3488c44))

## 1.0.0 (2026-04-22)

### Features

* **ci:** adotar workflows canônicos split + doctor + publish-tag ([ea8194d](https://github.com/Precisa-Saude/datasus-brasil/commit/ea8194d49df75ee6b88b1b7fcaa3938cd43decdc))
* consumir @precisa-saude/agent-instructions + worktree-cli ([9e91ee0](https://github.com/Precisa-Saude/datasus-brasil/commit/9e91ee06ae51f8226202b4c087ef421e64796771))
* **core,cli:** terminologia pública + CNES record labeler (PRE-200) ([#6](https://github.com/Precisa-Saude/datasus-brasil/issues/6)) ([b940743](https://github.com/Precisa-Saude/datasus-brasil/commit/b940743b0a577c7d198f363b2459a81ccce5f548))
* datasus-brasil v0.1 — decoder DBC, CNES, CLI e mapeamento LOINC↔TUSS↔SIGTAP ([#1](https://github.com/Precisa-Saude/datasus-brasil/issues/1)) ([27cd027](https://github.com/Precisa-Saude/datasus-brasil/commit/27cd0278c35e140e7204a8652d4d1f97cfc81676))

### Bug Fixes

* **ci:** concede contents: write no caller para _release.yml poder pedir ([08d5611](https://github.com/Precisa-Saude/datasus-brasil/commit/08d561180fea70c9205c800bbefc53df70e3df46)), closes [#16](https://github.com/Precisa-Saude/datasus-brasil/issues/16)
* pre-push fallback — typecheck/test topológicos, só lint paralelo ([6b86449](https://github.com/Precisa-Saude/datasus-brasil/commit/6b86449c31de2529fd6e4f34c96b865dd24c5a13))

### Tests

* **dbc:** cobrir caminhos de erro e decoders por tipo ([5bcae1d](https://github.com/Precisa-Saude/datasus-brasil/commit/5bcae1dc2b1fb40c44599d806eb2b719149f6599))
* excluir scripts de build e arquivos types.ts da cobertura ([5287766](https://github.com/Precisa-Saude/datasus-brasil/commit/5287766c360aec7a7e9e824b90684f0fa1fd7960))

### CI/CD

* drop --offline from pre-push pnpm install ([2834a16](https://github.com/Precisa-Saude/datasus-brasil/commit/2834a16cbac296af37cd0b5c3685991ac05ab4f5))
* normalizar workflows e templates de PR/issue ([8eabc49](https://github.com/Precisa-Saude/datasus-brasil/commit/8eabc492f8d9e5b73130533d548c5c5ecad7ef83))

### Chores

* alinhar hooks husky e turbo.json ao template compartilhado ([acd971a](https://github.com/Precisa-Saude/datasus-brasil/commit/acd971a136b30122085d6eaf38ad4d828961effa))
* aplicar drift safe-only do precisa sync ([3ada96c](https://github.com/Precisa-Saude/datasus-brasil/commit/3ada96c7e5fcd708453b47e37ab2b1393dd42441))
* aplicar fixes do template husky (turbo detection + regex var) ([98ac50f](https://github.com/Precisa-Saude/datasus-brasil/commit/98ac50f6bf62c72fc3439c4704c198af6fc5ee19))
* **config:** scaffold inicial do monorepo datasus-brasil ([04dc154](https://github.com/Precisa-Saude/datasus-brasil/commit/04dc154b0cfd8973a547f39900f10af037ac2e6f))
* **deps:** add renovate config ([808bd94](https://github.com/Precisa-Saude/datasus-brasil/commit/808bd94f52b7c9094fc8ac0c87d4e0214821b165))
* **deps:** adotar configs compartilhadas [@precisa-saude](https://github.com/precisa-saude) ([a42c894](https://github.com/Precisa-Saude/datasus-brasil/commit/a42c89447d1d0a862f182cd704068cf0ff46ca83))

# Changelog

Todas as alterações notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).
