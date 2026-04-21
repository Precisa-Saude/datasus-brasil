/**
 * Refina o mapeamento Biomarcador → TUSS → SIGTAP usando um LLM (Gemini 3.1
 * Pro via OpenRouter). Rodar como one-off depois do pipeline fuzzy —
 * o LLM reavalia cada biomarcador com top-K candidatos TUSS e seus SIGTAPs
 * oficiais, captura os erros semânticos que o fuzzy não pega (Apo A-I vs
 * Apo B, Sangue Oculto Urina vs Fezes, Fator V vs Reumatoide, etc.).
 *
 * ## Design
 *
 * - **Zero deps externas** — usa `fetch` nativo + `OPENROUTER_API_KEY`.
 * - **Pipeline híbrido** — fuzzy gera top-K candidatos TUSS (recall);
 *   LLM escolhe o certo e um SIGTAP oficial por baixo (precisão).
 * - **Stream/checkpoint**: escreve parcial em `.partial.json` a cada N
 *   entradas pra sobreviver a queda/timeout no meio.
 * - **Auditável**: cada decisão tem `reasoning` em 1-2 frases do LLM.
 *
 * ## Entrada
 *
 *   `packages/core/data/ans-tuss-sigtap-oficial.json` — tabela oficial ANS
 *   `fhir-brasil/packages/core/src/biomarkers.ts` — lista de biomarcadores
 *
 * ## Saída
 *
 *   `packages/core/data/loinc-tuss-sigtap.llm.json`      mapeamento final
 *   `packages/core/data/loinc-tuss-sigtap.llm.report.md` disagreements vs fuzzy
 *
 * ## Uso
 *
 *   OPENROUTER_API_KEY=sk-... pnpm run llm:refine-mapping
 *
 * ## Flags de ambiente
 *
 *   OPENROUTER_MODEL          modelo (default: google/gemini-3.1-pro-preview)
 *   LLM_CONCURRENCY           paralelismo de chamadas (default: 3)
 *   TUSS_CANDIDATES           top-K TUSS por biomarcador (default: 5)
 *   SIGTAP_OPTIONS            SIGTAPs por TUSS (default: 4)
 *   REPROCESS=disagreements   só reprocessa divergências do run anterior;
 *                             preserva concordâncias. Útil pra subir
 *                             TUSS_CANDIDATES sem pagar pelos 164 de novo.
 *   REPROCESS=low_confidence  só reprocessa entradas com confidence=low
 *                             ou reasoning vazio. Útil quando resposta
 *                             do LLM veio degenerada (Gemini às vezes
 *                             retorna JSON com tudo null/"").
 *   DEBUG_LLM=1               loga content cru da resposta quando vier
 *                             anêmica (reasoning vazio OU tudo null).
 *   DRY_RUN=1                 lista workset e sai sem chamar API.
 *
 * Temperatura fixa em 0 pra determinismo.
 *
 * ## Custo
 *
 * ~164 biomarcadores × ~1.5k tokens input + ~300 output ≈ 300k tokens total.
 * Gemini 3.1 Pro via OpenRouter: ordem de magnitude ~$1-3 por run completa.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Script vive em <repo>/scripts/; MONOREPO_ROOT = repo datasus-brasil.
const MONOREPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PRECISA_ROOT = resolve(MONOREPO_ROOT, '..');
const DATA_DIR = join(MONOREPO_ROOT, 'packages', 'core', 'data');
const BIOMARKERS_TS = join(PRECISA_ROOT, 'fhir-brasil', 'packages', 'core', 'src', 'biomarkers.ts');
const ANS_JSON = join(DATA_DIR, 'ans-tuss-sigtap-oficial.json');
const OUT_JSON = join(DATA_DIR, 'loinc-tuss-sigtap.llm.json');
const PARTIAL_JSON = join(DATA_DIR, 'loinc-tuss-sigtap.llm.partial.json');
const OUT_REPORT = join(DATA_DIR, 'loinc-tuss-sigtap.llm.report.md');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env['OPENROUTER_MODEL'] ?? 'google/gemini-3.1-pro-preview';
const CONCURRENCY = Number.parseInt(process.env['LLM_CONCURRENCY'] ?? '3', 10);
const TUSS_CANDIDATES_PER_BIOMARKER = Number.parseInt(process.env['TUSS_CANDIDATES'] ?? '5', 10);
const SIGTAP_OPTIONS_PER_TUSS = Number.parseInt(process.env['SIGTAP_OPTIONS'] ?? '4', 10);

/**
 * Modo de reprocessamento. Valores suportados:
 *   - `disagreements` — só reprocessa biomarcadores onde o LLM anterior
 *     discordou do fuzzy top-1. Preserva as concordâncias. Útil pra
 *     aumentar `TUSS_CANDIDATES` e dar ao LLM acesso a mais opções.
 */
const REPROCESS = process.env['REPROCESS'] ?? null;

const API_KEY = process.env['OPENROUTER_API_KEY'];
if (!API_KEY) {
  console.error('[erro] OPENROUTER_API_KEY não está setada no ambiente.');
  process.exit(2);
}

interface BiomarkerDefinition {
  category: string | string[];
  code: string;
  hidden?: boolean;
  loinc?: string;
  names: { en: string[]; pt: string[] };
  unit?: string;
}

interface AnsRow {
  grau_equivalencia: null | string;
  sigtap: null | string;
  sigtap_name: null | string;
  situacao: null | string;
  status: null | string;
  tuss: null | string;
  tuss_name: null | string;
}

interface AnsEnvelope {
  _source: Record<string, unknown>;
  rows: AnsRow[];
}

interface TussCandidate {
  fuzzy_score: number;
  sigtap_options: Array<{
    equivalencia: null | string;
    sigtap: string;
    sigtap_name: string;
    status: null | string;
  }>;
  tuss: string;
  tuss_name: string;
}

interface LlmDecision {
  confidence: 'high' | 'low' | 'medium';
  no_match_reason: null | string;
  reasoning: string;
  selected_sigtap: null | string;
  selected_tuss: null | string;
}

interface RefinedEntry {
  biomarker_code: string;
  biomarker_display: string;
  candidates_shown: TussCandidate[];
  category: string;
  error: null | string;
  llm: LlmDecision | null;
  loinc: null | string;
}

async function main(): Promise<void> {
  console.error(`[llm] modelo: ${MODEL}`);
  console.error(`[llm] concurrency: ${CONCURRENCY}`);

  const biomarkers = await loadBiomarkers();
  const visible = biomarkers.filter((b) => !b.hidden);
  console.error(`[biomarkers] ${visible.length} visíveis.`);

  const envelope = JSON.parse(await readFile(ANS_JSON, 'utf8')) as AnsEnvelope;
  const ansRows = envelope.rows;
  console.error(`[ans] ${ansRows.length} linhas oficiais.`);

  const tussUniverse = extractUniqueTuss(ansRows);
  const sigtapByTuss = indexSigtapByTuss(ansRows);

  // Determina progresso anterior e o que precisa ser (re)processado.
  //   - sem REPROCESS: lê checkpoint partial e retoma.
  //   - REPROCESS=disagreements: lê OUT_JSON, preserva concordâncias e
  //     força reprocessamento das divergências (útil com TUSS_CANDIDATES
  //     maior pra dar ao LLM acesso a mais opções).
  const { successful, todoCodes } = await decideWorkset(visible);
  const todo = visible.filter((b) => todoCodes.has(b.code));
  console.error(
    `[plano] ${successful.length} preservados · ${todo.length} a (re)processar` +
      ` · TUSS_CANDIDATES=${TUSS_CANDIDATES_PER_BIOMARKER}${REPROCESS ? ` · modo=${REPROCESS}` : ''}`,
  );

  if (process.env['DRY_RUN'] === '1') {
    console.error('[dry-run] DRY_RUN=1 — listando workset e saindo sem chamar API.');
    for (const b of todo) {
      console.error(`  · ${b.code}  (${b.names.pt[0] ?? b.names.en[0] ?? '?'})`);
    }
    return;
  }
  console.error(`[llm] chamando LLM pra ${todo.length} biomarcadores restantes...`);

  const results: RefinedEntry[] = [...successful];
  let completed = 0;
  const startedAt = Date.now();
  let abortError: Error | null = null;

  // Sanity check: chama o LLM pro primeiro biomarcador sincronamente antes
  // de subir o pool. Se o modelo ou a auth estiverem errados, aborta aqui
  // em segundos em vez de queimar dinheiro em 164 chamadas.
  if (todo.length > 0) {
    const probe = todo[0]!;
    console.error(`[probe] validando API com "${probe.code}"...`);
    const candidates = buildCandidates(probe, tussUniverse, sigtapByTuss);
    if (candidates.length > 0) {
      try {
        await callLlm(probe, candidates);
        console.error('[probe] OK — modelo e auth válidos.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Probe falhou — abortando antes de gastar mais chamadas.\n  ${msg}`, {
          cause: err,
        });
      }
    }
  }

  // Pool de concorrência manual — aborta no primeiro erro pra não
  // desperdiçar chamadas quando algo sistêmico dá errado no meio.
  const queue = todo.slice();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0 && abortError === null) {
        const b = queue.shift();
        if (!b) break;
        const candidates = buildCandidates(b, tussUniverse, sigtapByTuss);
        try {
          const entry = await processOne(b, candidates);
          results.push(entry);
          completed++;
        } catch (err) {
          abortError = err instanceof Error ? err : new Error(String(err));
          // Checkpoint antes de abortar pra não perder progresso
          await writeFile(PARTIAL_JSON, `${JSON.stringify(results, null, 2)}\n`);
          return;
        }
        if (completed % 5 === 0 || completed === todo.length) {
          await writeFile(PARTIAL_JSON, `${JSON.stringify(results, null, 2)}\n`);
          const elapsed = (Date.now() - startedAt) / 1000;
          const rate = completed / elapsed;
          const eta = (todo.length - completed) / Math.max(rate, 0.01);
          console.error(
            `[llm] ${completed}/${todo.length}  (${rate.toFixed(1)}/s, ETA ${eta.toFixed(0)}s)`,
          );
        }
      }
    }),
  );

  if (abortError !== null) {
    console.error(
      `[erro] abortando após ${completed} sucessos e primeira falha.\n  ${abortError.message}`,
    );
    console.error(`[erro] checkpoint salvo em ${PARTIAL_JSON} — rerode pra retomar.`);
    process.exit(1);
  }

  await writeFile(
    OUT_JSON,
    `${JSON.stringify({ _source: envelope._source, mapping: results, model: MODEL }, null, 2)}\n`,
  );
  await writeFile(OUT_REPORT, renderReport(results, envelope._source));

  // Limpa checkpoint
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(PARTIAL_JSON);
  } catch {
    // ignore
  }

  const summary = summarize(results);
  console.error(
    `[done] ${summary.total} biomarcadores processados: ` +
      `${summary.high} high / ${summary.medium} medium / ${summary.low} low / ` +
      `${summary.noMatch} no-match / ${summary.errors} errors. ` +
      `${summary.disagreements} divergem do fuzzy.`,
  );
  console.error(`[output] ${OUT_JSON}`);
  console.error(`[output] ${OUT_REPORT}`);
}

async function loadBiomarkers(): Promise<BiomarkerDefinition[]> {
  const mod = (await import(`file://${BIOMARKERS_TS}`)) as {
    BIOMARKER_DEFINITIONS: BiomarkerDefinition[];
  };
  return mod.BIOMARKER_DEFINITIONS;
}

async function loadPartial(): Promise<RefinedEntry[]> {
  try {
    const s = await stat(PARTIAL_JSON);
    if (!s.isFile()) return [];
    const raw = await readFile(PARTIAL_JSON, 'utf8');
    return JSON.parse(raw) as RefinedEntry[];
  } catch {
    return [];
  }
}

/**
 * Decide quais biomarcadores preservar vs reprocessar.
 *
 * Modo default: retoma do checkpoint `.partial.json` (preserva sucessos,
 * retenta falhas).
 *
 * `REPROCESS=disagreements`: lê o output final anterior, preserva as
 * linhas onde o LLM concordou com o fuzzy top-1, força reprocessamento
 * das 60 divergências. Ignora o checkpoint partial.
 */
async function decideWorkset(
  visible: BiomarkerDefinition[],
): Promise<{ successful: RefinedEntry[]; todoCodes: Set<string> }> {
  const allCodes = new Set(visible.map((b) => b.code));

  if (REPROCESS === 'low_confidence') {
    const raw = await readFile(OUT_JSON, 'utf8').catch(() => null);
    if (raw === null) {
      throw new Error(`REPROCESS=low_confidence exige output anterior em ${OUT_JSON}.`);
    }
    const prior = JSON.parse(raw) as { mapping?: RefinedEntry[] };
    const entries = prior.mapping ?? [];
    const successful: RefinedEntry[] = [];
    const todoCodes = new Set<string>();
    for (const e of entries) {
      if (!allCodes.has(e.biomarker_code)) continue;
      const isLow =
        e.llm === null ||
        e.llm.confidence === 'low' ||
        (typeof e.llm.reasoning === 'string' && e.llm.reasoning.length === 0);
      if (isLow || e.error !== null) {
        todoCodes.add(e.biomarker_code);
      } else {
        successful.push(e);
      }
    }
    const seenCodes = new Set(entries.map((e) => e.biomarker_code));
    for (const code of allCodes) {
      if (!seenCodes.has(code)) todoCodes.add(code);
    }
    return { successful, todoCodes };
  }

  if (REPROCESS === 'disagreements') {
    const raw = await readFile(OUT_JSON, 'utf8').catch(() => null);
    if (raw === null) {
      throw new Error(
        `REPROCESS=disagreements exige output anterior em ${OUT_JSON} — rode sem flag primeiro.`,
      );
    }
    const prior = JSON.parse(raw) as { mapping?: RefinedEntry[] };
    const entries = prior.mapping ?? [];
    const successful: RefinedEntry[] = [];
    const todoCodes = new Set<string>();
    for (const e of entries) {
      if (!allCodes.has(e.biomarker_code)) continue; // biomarcador removido em biomarkers.ts
      if (!e.llm || e.error !== null) {
        todoCodes.add(e.biomarker_code);
        continue;
      }
      const fuzzyTop = e.candidates_shown[0]?.sigtap_options[0]?.sigtap ?? null;
      if (e.llm.selected_sigtap !== fuzzyTop) {
        todoCodes.add(e.biomarker_code); // divergência → reprocessar
      } else {
        successful.push(e);
      }
    }
    // Biomarcadores ausentes do output anterior também vão pro todo
    const seenCodes = new Set(entries.map((e) => e.biomarker_code));
    for (const code of allCodes) {
      if (!seenCodes.has(code)) todoCodes.add(code);
    }
    return { successful, todoCodes };
  }

  const partial = await loadPartial();
  const successful = partial.filter((e) => e.error === null && e.llm !== null);
  const doneCodes = new Set(successful.map((e) => e.biomarker_code));
  const todoCodes = new Set<string>();
  for (const code of allCodes) {
    if (!doneCodes.has(code)) todoCodes.add(code);
  }
  return { successful, todoCodes };
}

function extractUniqueTuss(rows: AnsRow[]): Array<{ name: string; tuss: string }> {
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.tuss && r.tuss_name && !seen.has(r.tuss)) seen.set(r.tuss, r.tuss_name);
  }
  return Array.from(seen, ([tuss, name]) => ({ name, tuss }));
}

function indexSigtapByTuss(rows: AnsRow[]): Map<string, AnsRow[]> {
  const idx = new Map<string, AnsRow[]>();
  for (const r of rows) {
    if (r.tuss === null) continue;
    const arr = idx.get(r.tuss) ?? [];
    arr.push(r);
    idx.set(r.tuss, arr);
  }
  return idx;
}

/**
 * Gera top-K candidatos TUSS pelo nome (fuzzy), e pra cada um pega
 * top-N SIGTAPs oficiais com melhor grau de equivalência.
 */
function buildCandidates(
  biomarker: BiomarkerDefinition,
  tussUniverse: Array<{ name: string; tuss: string }>,
  sigtapByTuss: Map<string, AnsRow[]>,
): TussCandidate[] {
  const biomarkerTokens = new Set<string>();
  for (const n of biomarker.names.pt) {
    for (const tok of tokenize(n)) biomarkerTokens.add(tok);
  }
  if (biomarkerTokens.size === 0) return [];

  const scored: Array<{ name: string; score: number; tuss: string }> = [];
  for (const t of tussUniverse) {
    const tussTokens = new Set(tokenize(t.name));
    if (tussTokens.size === 0) continue;
    let intersection = 0;
    for (const tok of biomarkerTokens) if (tussTokens.has(tok)) intersection++;
    if (intersection === 0) continue;
    const overlap = intersection / Math.min(biomarkerTokens.size, tussTokens.size);
    const jac = intersection / (biomarkerTokens.size + tussTokens.size - intersection);
    scored.push({ name: t.name, score: 0.7 * overlap + 0.3 * jac, tuss: t.tuss });
  }
  scored.sort((a, b) => b.score - a.score);
  const topK = scored.slice(0, TUSS_CANDIDATES_PER_BIOMARKER);

  return topK.map(({ name, score, tuss }) => {
    const rows = sigtapByTuss.get(tuss) ?? [];
    const mapped = rows
      .filter((r) => r.sigtap !== null)
      .sort((a, b) => grauOrder(a.grau_equivalencia) - grauOrder(b.grau_equivalencia))
      .slice(0, SIGTAP_OPTIONS_PER_TUSS);
    return {
      fuzzy_score: score,
      sigtap_options: mapped.map((r) => ({
        equivalencia: r.grau_equivalencia,
        sigtap: r.sigtap!,
        sigtap_name: r.sigtap_name ?? '',
        status: r.status,
      })),
      tuss,
      tuss_name: name,
    };
  });
}

function grauOrder(grau: null | string): number {
  const g = grau ?? '?';
  const rank: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };
  return rank[g] ?? 6;
}

async function processOne(
  biomarker: BiomarkerDefinition,
  candidates: TussCandidate[],
): Promise<RefinedEntry> {
  const base: Omit<RefinedEntry, 'error' | 'llm'> = {
    biomarker_code: biomarker.code,
    biomarker_display: biomarker.names.pt[0] ?? biomarker.names.en[0] ?? biomarker.code,
    candidates_shown: candidates,
    category: Array.isArray(biomarker.category) ? biomarker.category.join(',') : biomarker.category,
    loinc: biomarker.loinc ?? null,
  };

  if (candidates.length === 0) {
    return {
      ...base,
      error: null,
      llm: {
        confidence: 'high',
        no_match_reason:
          'Nenhum TUSS candidato encontrado via fuzzy (biomarcador provavelmente privado/genético sem equivalente SUS).',
        reasoning: 'skipped',
        selected_sigtap: null,
        selected_tuss: null,
      },
    };
  }

  // Propaga erro de API em vez de capturar — fail-fast evita queimar
  // 150+ chamadas pagas quando o modelo/auth estão errados.
  const decision = await callLlm(biomarker, candidates);
  return { ...base, error: null, llm: decision };
}

async function callLlm(
  biomarker: BiomarkerDefinition,
  candidates: TussCandidate[],
): Promise<LlmDecision> {
  const system = `Você é um especialista em terminologia médica brasileira (LOINC, TUSS, SIGTAP).

Dado um biomarcador laboratorial, recebe uma lista de códigos TUSS candidatos (cada um com códigos SIGTAP oficialmente mapeados pela ANS). Sua tarefa é escolher o par TUSS+SIGTAP que representa o MESMO exame que o biomarcador, ou indicar que não há equivalente no SUS.

Graus de equivalência ANS/ISO TR 12300:2014:
- 1: léxico + conceitual idêntico
- 2: sinonímia
- 3: TUSS menos específico que SIGTAP
- 4: TUSS mais específico que SIGTAP
- 5: não mapeável

Atenção especial a armadilhas:
- "Sangue oculto na urina" ≠ "Sangue oculto nas fezes" (espécime diferente)
- Apolipoproteína A (Apo A) ≠ Apolipoproteína B (Apo B) ≠ Apolipoproteína A-1
- Fator V (coagulação) ≠ Fator Reumatoide (autoanticorpo)
- Cálcio sérico ≠ Escore de Cálcio Coronariano (imagem)
- Creatina ≠ Creatinina ≠ Creatina Quinase (CK/CPK)
- Proteína C (coagulação) ≠ Proteína C-Reativa (inflamação)

Responda SOMENTE em JSON válido, com:
{
  "selected_tuss": "código TUSS de 8 dígitos ou null",
  "selected_sigtap": "código SIGTAP de 10 dígitos ou null",
  "confidence": "high" | "medium" | "low",
  "reasoning": "1-2 frases explicando a escolha",
  "no_match_reason": "se selected_*=null, por quê; caso contrário null"
}`;

  const user = JSON.stringify(
    {
      biomarker: {
        code: biomarker.code,
        display: biomarker.names.pt[0] ?? biomarker.names.en[0],
        loinc: biomarker.loinc ?? null,
        names_en: biomarker.names.en,
        names_pt: biomarker.names.pt,
        unit: biomarker.unit ?? null,
      },
      candidates,
    },
    null,
    2,
  );

  const body = {
    messages: [
      { content: system, role: 'system' },
      { content: user, role: 'user' },
    ],
    model: MODEL,
    response_format: { type: 'json_object' },
    temperature: 0,
  };

  // Retry camada interna: trata erros upstream mascarados como HTTP 200
  // (ex: choices[0].error = { code: 502, "provider_unavailable" }), que
  // o fetchWithRetry externo não captura porque o response HTTP está OK.
  let parsed: Record<string, unknown> | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetchWithRetry(OPENROUTER_URL, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Precisa-Saude/datasus-brasil',
        'X-Title': 'datasus-brasil LLM mapping refinement',
      },
      method: 'POST',
    });

    const json = (await res.json()) as {
      choices?: Array<{
        error?: { code: number; message?: string };
        message?: { content?: null | string };
      }>;
    };
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (content) {
      parsed = extractJson(content);
      break;
    }
    const upstream = choice?.error;
    if (upstream && attempt < 3) {
      console.error(
        `[llm] upstream error (tentativa ${attempt}/3): ${upstream.code} ${upstream.message ?? ''}`,
      );
      await sleep(2_000 * attempt);
      continue;
    }
    throw new Error(
      `Resposta sem content após ${attempt} tentativa(s): ${JSON.stringify(json).slice(0, 500)}`,
    );
  }
  if (parsed === null) throw new Error('parsed is null após loop de retry (bug)');

  // Detecta resposta anêmica — reasoning vazio E nenhum campo de decisão
  // preenchido. Gemini ocasionalmente retorna só o chain-of-thought sem
  // preencher o schema. Log pro debug.
  const hasReasoning = typeof parsed['reasoning'] === 'string' && parsed['reasoning'].length > 0;
  const hasAnyField =
    parsed['selected_tuss'] !== null ||
    parsed['selected_sigtap'] !== null ||
    parsed['no_match_reason'] !== null;
  if (process.env['DEBUG_LLM'] === '1' && !hasReasoning && !hasAnyField) {
    console.error(
      `[debug] resposta anêmica pra ${biomarker.code}: ${JSON.stringify(parsed).slice(0, 400)}`,
    );
  }
  return {
    confidence: (parsed['confidence'] as LlmDecision['confidence']) ?? 'low',
    no_match_reason: (parsed['no_match_reason'] as null | string) ?? null,
    reasoning: (parsed['reasoning'] as string) ?? '',
    selected_sigtap: (parsed['selected_sigtap'] as null | string) ?? null,
    selected_tuss: (parsed['selected_tuss'] as null | string) ?? null,
  };
}

function extractJson(raw: string): Record<string, unknown> {
  // Alguns modelos envelopam em ```json ... ```; outros retornam array
  // [{obj}] em vez de objeto direto (Gemini faz isso com
  // response_format json_object — bug conhecido).
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced?.[1]?.trim() ?? raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const match = /\{[\s\S]*\}/.exec(candidate);
    if (!match) throw new Error(`Falha parseando JSON do LLM: ${raw.slice(0, 300)}`);
    parsed = JSON.parse(match[0]);
  }
  // Desembrulha array single-element: [{obj}] → {obj}
  if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'object') {
    parsed = parsed[0];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Esperava objeto JSON, recebi ${typeof parsed}: ${raw.slice(0, 300)}`);
  }
  return parsed as Record<string, unknown>;
}

async function fetchWithRetry(url: string, init: RequestInit, maxAttempts = 4): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = await res.text();
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        await sleep(Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      await sleep(Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenize(s: string): string[] {
  const stop = new Set([
    'a',
    'de',
    'da',
    'do',
    'dos',
    'das',
    'e',
    'ou',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'para',
    'por',
    'com',
    'sem',
    'pesquisa',
    'dosagem',
    'determinacao',
    'nivel',
    'total',
    'exame',
  ]);
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !stop.has(t));
}

function summarize(results: RefinedEntry[]): {
  disagreements: number;
  errors: number;
  high: number;
  low: number;
  medium: number;
  noMatch: number;
  total: number;
} {
  let high = 0;
  let medium = 0;
  let low = 0;
  let noMatch = 0;
  let errors = 0;
  let disagreements = 0;
  for (const r of results) {
    if (r.error !== null) {
      errors++;
      continue;
    }
    if (r.llm === null) {
      errors++;
      continue;
    }
    if (r.llm.confidence === 'high') high++;
    else if (r.llm.confidence === 'medium') medium++;
    else low++;
    if (r.llm.selected_sigtap === null) noMatch++;
    const fuzzyTop = r.candidates_shown[0];
    const fuzzyPick = fuzzyTop?.sigtap_options[0]?.sigtap ?? null;
    if (r.llm.selected_sigtap !== fuzzyPick) disagreements++;
  }
  return { disagreements, errors, high, low, medium, noMatch, total: results.length };
}

function renderReport(results: RefinedEntry[], source: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push('# Mapeamento refinado por LLM');
  lines.push('');
  lines.push(`Modelo: **${MODEL}** via OpenRouter.`);
  lines.push(`Gerado por \`scripts/llm-refine-mapping.ts\`.`);
  lines.push('');
  lines.push('## Fonte do mapeamento oficial');
  lines.push('');
  lines.push(`- **Arquivo:** \`${source['file'] ?? '?'}\``);
  lines.push(`- **Publicador:** ${source['publisher'] ?? '?'}`);
  lines.push(`- **URL:** ${source['url'] ?? '?'}`);
  lines.push(`- **Competência:** ${source['competence'] ?? '?'}`);
  lines.push('');

  const s = summarize(results);
  lines.push('## Resumo');
  lines.push('');
  lines.push(`- Total: **${s.total}**`);
  lines.push(`- Confiança alta: **${s.high}**`);
  lines.push(`- Confiança média: **${s.medium}**`);
  lines.push(`- Confiança baixa: **${s.low}**`);
  lines.push(`- Sem match SUS: **${s.noMatch}**`);
  lines.push(`- Erros de API: **${s.errors}**`);
  lines.push(`- **Divergências vs fuzzy top-1: ${s.disagreements}** ← foco da revisão`);
  lines.push('');

  const disagreements = results.filter((r) => {
    if (!r.llm) return false;
    const fuzzyTop = r.candidates_shown[0]?.sigtap_options[0]?.sigtap ?? null;
    return r.llm.selected_sigtap !== fuzzyTop;
  });

  lines.push('## Divergências LLM vs fuzzy (prioridade de revisão)');
  lines.push('');
  for (const r of disagreements) {
    if (!r.llm) continue;
    const fuzzyTop = r.candidates_shown[0];
    const fuzzySigtap = fuzzyTop?.sigtap_options[0];
    lines.push(`### ${r.biomarker_display} (LOINC ${r.loinc ?? '—'})`);
    lines.push('');
    lines.push(
      `- **Fuzzy top-1:** TUSS \`${fuzzyTop?.tuss ?? '—'}\` → SIGTAP \`${fuzzySigtap?.sigtap ?? '—'}\` (${fuzzySigtap?.sigtap_name ?? '—'})`,
    );
    lines.push(
      `- **LLM escolheu:** TUSS \`${r.llm.selected_tuss ?? '—'}\` → SIGTAP \`${r.llm.selected_sigtap ?? '—'}\` _(${r.llm.confidence})_`,
    );
    lines.push(`- **Raciocínio:** ${r.llm.reasoning}`);
    if (r.llm.no_match_reason) {
      lines.push(`- **Sem match:** ${r.llm.no_match_reason}`);
    }
    lines.push('');
  }

  const agreements = results.filter((r) => {
    if (!r.llm) return false;
    const fuzzyTop = r.candidates_shown[0]?.sigtap_options[0]?.sigtap ?? null;
    return r.llm.selected_sigtap === fuzzyTop && r.llm.selected_sigtap !== null;
  });
  lines.push('## LLM concorda com fuzzy top-1 (revisão opcional)');
  lines.push('');
  for (const r of agreements) {
    if (!r.llm) continue;
    lines.push(
      `- ${r.biomarker_display} → TUSS \`${r.llm.selected_tuss}\` / SIGTAP \`${r.llm.selected_sigtap}\` _(${r.llm.confidence})_`,
    );
  }
  lines.push('');

  const noMatch = results.filter((r) => r.llm?.selected_sigtap === null && !r.error);
  if (noMatch.length > 0) {
    lines.push('## Sem match SUS (LLM concluiu)');
    lines.push('');
    for (const r of noMatch) {
      if (!r.llm) continue;
      lines.push(`- ${r.biomarker_display} — _${r.llm.no_match_reason ?? r.llm.reasoning}_`);
    }
    lines.push('');
  }

  const errs = results.filter((r) => r.error !== null);
  if (errs.length > 0) {
    lines.push('## Erros de API');
    lines.push('');
    for (const r of errs) {
      lines.push(`- ${r.biomarker_display}: ${r.error}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

await mkdir(DATA_DIR, { recursive: true });
await main();
