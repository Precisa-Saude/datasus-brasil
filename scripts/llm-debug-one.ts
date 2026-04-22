/**
 * Debug: chama o LLM pra 1 biomarcador e imprime a resposta crua.
 * Uso:
 *   OPENROUTER_API_KEY=... pnpm exec tsx scripts/llm-debug-one.ts HbA1c
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MONOREPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PRECISA_ROOT = resolve(MONOREPO_ROOT, '..');
const BIOMARKERS_TS = join(PRECISA_ROOT, 'fhir-brasil', 'packages', 'core', 'src', 'biomarkers.ts');
const OUT_JSON = join(MONOREPO_ROOT, 'packages', 'core', 'data', 'loinc-tuss-sigtap.llm.json');

const MODEL = process.env['OPENROUTER_MODEL'] ?? 'google/gemini-3.1-pro-preview';
const API_KEY = process.env['OPENROUTER_API_KEY'];
if (!API_KEY) {
  console.error('no OPENROUTER_API_KEY');
  process.exit(2);
}

const targetCode = process.argv[2];
if (!targetCode) {
  console.error('uso: tsx llm-debug-one.ts <BIOMARKER_CODE>');
  process.exit(2);
}

const biomarkers = (await import(`file://${BIOMARKERS_TS}`)) as {
  BIOMARKER_DEFINITIONS: Array<{
    code: string;
    loinc?: string;
    names: { en: string[]; pt: string[] };
    unit?: string;
  }>;
};
const biomarker = biomarkers.BIOMARKER_DEFINITIONS.find((b) => b.code === targetCode);
if (!biomarker) {
  console.error(`biomarcador "${targetCode}" não encontrado`);
  process.exit(2);
}

const out = JSON.parse(await readFile(OUT_JSON, 'utf8')) as {
  mapping: Array<{ biomarker_code: string; candidates_shown: unknown }>;
};
const existing = out.mapping.find((e) => e.biomarker_code === targetCode);
if (!existing) {
  console.error(`sem entrada anterior pra ${targetCode}`);
  process.exit(2);
}

const body = {
  messages: [
    {
      content: `Você é especialista em terminologia médica brasileira. Dado um biomarcador e candidatos TUSS+SIGTAP, escolha o match correto ou indique que não há. Responda SOMENTE em JSON: {"selected_tuss": "...", "selected_sigtap": "...", "confidence": "high|medium|low", "reasoning": "...", "no_match_reason": "..."}`,
      role: 'system',
    },
    {
      content: JSON.stringify(
        {
          biomarker: {
            code: biomarker.code,
            display: biomarker.names.pt[0] ?? biomarker.names.en[0],
            loinc: biomarker.loinc ?? null,
            names_pt: biomarker.names.pt,
          },
          candidates: existing.candidates_shown,
        },
        null,
        2,
      ),
      role: 'user',
    },
  ],
  model: MODEL,
  response_format: { type: 'json_object' },
  temperature: 0,
};

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  body: JSON.stringify(body),
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/Precisa-Saude/datasus-brasil',
    'X-Title': 'datasus-brasil debug',
  },
  method: 'POST',
});
const json = await res.json();
console.log('=== HTTP', res.status);
console.log(JSON.stringify(json, null, 2));
