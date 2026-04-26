# Plano — novas visualizações para SIA

## Contexto

Hoje o site exibe os microdados SIA-PA apenas como mapa coroplético
(UF → município) com tabela lateral. O grão dos parquets pré-agregados
é `(UF, município, LOINC, competência YYYY-MM)` com medidas
`volumeExames` e `valorAprovadoBRL`. Há 18 anos de histórico e 164
biomarcadores do catálogo FHIR (`@precisa-saude/datasus-sdk`)
mapeados via SIGTAP→LOINC.

O mapa responde uma única pergunta — _"onde, em uma dada competência,
um exame foi realizado?"_. O dataset suporta muitas outras perguntas
sem tocar o pipeline upstream, e algumas perguntas adicionais com uma
extensão pequena de pipeline (não bloqueante para este plano).

Este plano cobre dois eixos:

1. Quais perguntas novas valem a pena responder.
2. Quais visualizações do recharts (catálogo do issue
   [rlueder/recharts#2](https://github.com/rlueder/recharts/issues/2))
   melhor se encaixam — separando o que existe hoje do que vale ser
   contribuído upstream via PR.

## Perguntas que valem ser respondidas

Agrupadas por dimensão. Marcação `[cache]` = atende com os parquets
atuais; `[pipeline]` = exige uma extensão da agregação em
`datasus-parquet`.

### Eixo temporal (histórico de 18 anos disponível)

- **[cache]** Tendência mensal de volume por exame (nacional e por UF).
- **[cache]** Sazonalidade: heatmap competência × exame para detectar
  picos (ex.: glicemia em campanhas, dengue em verão).
- **[cache]** Crescimento YoY por exame — quais subiram/caíram mais
  desde 2008?
- **[cache]** Custo médio por exame (`valorAprovadoBRL / volumeExames`)
  ao longo do tempo — corrigido por inflação seria ideal, mas
  variação relativa já é informativa.
- **[cache]** Ranking top-10 exames ano a ano (rank-flow / bump).

### Eixo geográfico

- **[cache]** Top exames mais comuns por UF e por região, comparados
  ao perfil nacional.
- **[cache]** Disparidade geográfica: para cada exame, qual o índice
  de concentração (ex.: % do volume nas 5 UFs mais ricas) — exames
  "centralizados em capital" vs distribuídos.
- **[cache + IBGE]** Taxa per capita por UF. Requer join com
  população IBGE (~30 KB JSON, fonte oficial). Sem isto, mapas e
  rankings refletem só tamanho populacional.
- **[cache]** Cobertura municipal: quantos municípios da UF têm pelo
  menos N exames/ano? Quantos não fazem nenhum exame da categoria?

### Eixo catálogo (comparação com FHIR)

A pipeline hoje filtra para LOINCs mapeados — procedimentos SIGTAP
**não mapeados são silenciosamente descartados**. Isto esconde a
pergunta mais interessante para Precisa Saúde: _"o que o SUS realiza
que ainda não está no nosso catálogo FHIR?"_

- **[pipeline]** Cobertura do catálogo: % do volume SIA-PA total que
  mapeia para os 164 biomarcadores FHIR. Esperado: alto para
  bioquímica básica, baixo para exames de imagem, microbiologia.
- **[pipeline]** Top SIGTAPs **não mapeados** por volume — lista
  priorizada de candidatos para expandir o catálogo FHIR.
- **[cache]** Biomarcadores FHIR com volume zero em uma UF/município —
  exames "no papel" mas sem realização.
- **[cache]** Biomarcadores presentes no catálogo mas com declínio de
  volume — possíveis substituições por exame mais novo (ex.: HbA1c
  substituindo curva glicêmica).

A extensão de pipeline é pequena: emitir um segundo parquet
`unmapped-totals.parquet` agregando `(UF, sigtap_code, competência) →
volume, valor` antes do filtro LOINC. Não bloqueia nada deste plano,
mas habilita as duas perguntas mais valiosas. Trabalho upstream em
`datasus-parquet`, fora do escopo deste repo.

### Cruzamentos (precisam pipeline)

Demografia (faixa etária, sexo), complexidade e fonte de
financiamento existem nos microdados crus mas **não** nos agregados.
Adicionar como dimensões na agregação tornaria possível: pirâmide
etária por exame, distribuição por sexo, mix
ambulatorial/hospitalar — mas explode o tamanho dos parquets.
Recomendo deixar para uma fase 2, depois de validar quais perguntas
acima movem agulha.

## Visualizações recharts

Reaproveitando o catálogo do issue #2. Classifico cada candidato em
três grupos: **disponível agora** no recharts main, **PR upstream em
andamento** (vamos consumir quando merge), e **lacuna a contribuir**
via PR (oportunidade de upstream).

### Disponíveis hoje em recharts

| Chart                 | Encaixe                                                   |
| --------------------- | --------------------------------------------------------- |
| LineChart / AreaChart | Tendência mensal por exame; YoY.                          |
| ComposedChart         | Volume (barra) + valor médio (linha) sobrepostos.         |
| BarChart horizontal   | Ranking top-N exames por UF.                              |
| Treemap               | Mix de exames hierárquico Região→UF→Exame.                |
| Sankey                | Fluxo SIGTAP → LOINC (mostra colapsos N→1 do mapeamento). |
| ScatterChart          | Volume vs custo médio por exame; cada ponto = UF.         |
| RadarChart            | Perfil de exames de uma UF vs média nacional (top-8).     |
| PieChart / RadialBar  | % de cobertura do catálogo (total simples).               |

### PRs upstream em andamento (consumir quando merge)

| Chart            | PR                                                                                                               | Encaixe                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Heatmap          | [#7225](https://github.com/recharts/recharts/pull/7225)                                                          | UF × exame, ou competência × exame para sazonalidade. **Maior ganho** entre os pendentes. |
| Calendar heatmap | [#7227](https://github.com/recharts/recharts/pull/7227)                                                          | Volume nacional total por mês ao longo dos anos — visão "GitHub contributions" do SUS.    |
| Box plot         | [#7130](https://github.com/recharts/recharts/pull/7130), [#7067](https://github.com/recharts/recharts/pull/7067) | Distribuição de custo-por-exame entre municípios — outliers.                              |
| Word cloud       | [#7226](https://github.com/recharts/recharts/pull/7226)                                                          | Top exames de uma UF dimensionados por volume. Estética > análise; uso opcional.          |
| Polar scatter    | [#7228](https://github.com/recharts/recharts/pull/7228)                                                          | Pouco uso direto aqui; pular.                                                             |
| Circle packing   | [#7230](https://github.com/recharts/recharts/pull/7230)                                                          | Alternativa ao treemap para hierarquia exame→subgrupo.                                    |
| Venn             | [#7229](https://github.com/recharts/recharts/pull/7229)                                                          | Sobreposição catálogo FHIR vs SIA realizado vs LOINC universe.                            |

### Lacunas a contribuir upstream

Boas oportunidades de PR para o fork `rlueder/recharts`, todas com
encaixe direto neste projeto:

| Chart                  | Complexidade (issue #2)                                                     | Por que vale para nós                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bullet chart**       | Low-Medium — já há [fork PR #3](https://github.com/rlueder/recharts/pull/3) | Cobertura por UF: realizado vs meta (média nacional), com bandas qualitativas. Encaixe perfeito em dashboard de cobertura do catálogo FHIR.              |
| **Histogram**          | Low — sem PR aberto                                                         | Distribuição de volume por município (long tail típica de SUS). Adição mais limpa do catálogo: binning + bar render. Boa primeira contribuição.          |
| **Mosaic / Marimekko** | Medium-High — sem PR                                                        | Mix de exames por UF com largura proporcional ao volume total da UF — comunica "perfil + escala" simultaneamente. Não há substituto natural em recharts. |
| **Bump chart**         | Medium — sem PR                                                             | Ranking dos top-10 exames ano a ano (linha que cruza). Pergunta narrativa forte para 18 anos de série.                                                   |
| **Waterfall**          | Low — só exemplo, sem componente                                            | Decomposição YoY: volume 2023 = volume 2022 + Δ exame A + Δ exame B + ... . Útil para slide/storytelling.                                                |

Ordem sugerida de contribuição: **histogram → bullet (fechar fork PR
#3) → mosaic → bump → waterfall**. Todas low-low/medium e cada uma
desbloqueia uma pergunta deste plano que hoje não tem visual nativo.

## Recomendação de ordem de implementação no site

Para um primeiro corte enxuto, antes de entrar em PRs upstream:

1. **Tendência temporal** (LineChart) — pergunta mais óbvia, dado já
   está cacheado, zero risco.
2. **Top-N exames** (BarChart horizontal) com seletor UF/nacional.
3. **Heatmap competência × exame** assim que [#7225][hm-pr] mergear;
   até lá, prototipar com `cells` em ScatterChart como fallback.
4. **Treemap exame por região** — alternativa ao mapa para quem quer
   ler proporção, não geografia.
5. **Sankey SIGTAP→LOINC** — explica o pipeline visualmente, gera
   confiança.
6. Comparativo com catálogo FHIR (cobertura + top não-mapeados),
   após extensão da pipeline em `datasus-parquet`.

[hm-pr]: https://github.com/recharts/recharts/pull/7225

## Arquivos relevantes

- `site/src/lib/queries.ts` — adicionar consultas DuckDB para as
  novas perguntas (manter padrão `fetchUfAggregates` /
  `fetchMunicipioAggregates`).
- `site/public/data/manifest/index.json` — declarar novas dimensões
  ou rotas se forem expostas.
- `site/src/components/` — adicionar componentes por chart, um por
  arquivo, alinhado com `BrasilMap.tsx` / `OverviewTable.tsx`.
- `datasus-parquet` (repo separado) — extensão para emitir
  `unmapped-totals.parquet` (fora deste repo).

## Verificação

- Servidor dev rodando em `http://localhost:4332` (este worktree).
- Cada nova visualização: smoke test manual em UF grande (SP),
  pequena (RR), com competência recente e antiga.
- Coverage 80% nos hooks/queries novos.
- README atualizado listando as visualizações disponíveis.

## Decisão (2026-04-26)

Caminho **(A)** escolhido — implementar com recharts existente. **Sem
reprocessamento de parquet**: trabalhar somente com `uf-totals.parquet`
e `uf={UF}/part.parquet` como estão hoje.

Implicações:

- Eliminados deste plano: comparação com catálogo FHIR (exigia
  `unmapped-totals.parquet`), demografia, complexidade, financiamento.
- Mantidos: tendências temporais, ranking, sazonalidade, treemap,
  sankey SIGTAP→LOINC (mapeamento já vem do SDK em runtime, não
  precisa do parquet), disparidade geográfica.
- Per capita IBGE permanece opcional — JSON externo de ~30 KB, não é
  reprocessamento de parquet.

Ordem confirmada:

1. LineChart — tendência mensal por exame (nacional + UF).
2. BarChart horizontal — top-N exames com seletor UF/nacional.
3. Treemap — mix de exames por região/UF.
4. Sankey SIGTAP→LOINC — explica o mapeamento visualmente.
5. Heatmap competência × exame — fallback ScatterChart enquanto
   [#7225][hm-pr] não merge.

Itens 6+ (catálogo FHIR, demografia) ficam para fase futura quando
houver apetite por reprocessar os parquets.
