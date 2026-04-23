import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs, UsageError } from '../../src/args.js';
import { runSia } from '../../src/commands/sia.js';

vi.mock('@precisa-saude/datasus', async (importActual) => {
  const actual = await importActual<typeof import('@precisa-saude/datasus')>();
  return {
    ...actual,
    sia: {
      ...actual.sia,
      loadProducaoAmbulatorial: vi.fn(),
      streamProducaoAmbulatorial: vi.fn(),
    },
  };
});

const { sia } = await import('@precisa-saude/datasus');

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

const capture = async (fn: () => Promise<void>): Promise<{ err: string; out: string }> => {
  let out = '';
  let err = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  });
  try {
    await fn();
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { err, out };
};

describe('runSia', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('agrega top-N procedimentos SIGTAP com rótulo', async () => {
    vi.mocked(sia.streamProducaoAmbulatorial).mockReturnValue(
      fromArray([
        { PA_PROC_ID: '0202010279' },
        { PA_PROC_ID: '0202010279' },
        { PA_PROC_ID: '0301010072' },
      ]) as never,
    );

    const args = parseArgs(['--uf', 'AC', '--year', '2024', '--month', '1', '--top', '2']);
    const { out } = await capture(() => runSia(args));

    expect(sia.streamProducaoAmbulatorial).toHaveBeenCalledWith(
      expect.objectContaining({
        ftp: expect.objectContaining({ onProgress: expect.any(Function) }) as object,
        month: 1,
        uf: 'AC',
        year: 2024,
      }) as object,
    );
    const parsed = JSON.parse(out) as Array<{ count: number; procedimento: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.count).toBe(2);
    expect(parsed[0]!.procedimento).toBe('0202010279');
  });

  it('--laboratory filtra só procedimentos SIGTAP 02.02', async () => {
    vi.mocked(sia.streamProducaoAmbulatorial).mockReturnValue(
      fromArray([
        { PA_PROC_ID: '0202010279' }, // laboratório
        { PA_PROC_ID: '0301010072' }, // consulta — fora do grupo 0202
        { PA_PROC_ID: '0202060246' }, // laboratório
      ]) as never,
    );

    const args = parseArgs([
      '--uf',
      'AC',
      '--year',
      '2024',
      '--month',
      '1',
      '--laboratory',
      '--top',
      '10',
    ]);
    const { out } = await capture(() => runSia(args));
    const parsed = JSON.parse(out) as Array<{ procedimento: string }>;
    for (const r of parsed) {
      expect(r.procedimento.startsWith('0202')).toBe(true);
    }
    expect(parsed).toHaveLength(2);
  });

  it('--enrich-loinc anexa biomarker e loinc ao agregado', async () => {
    // Pega um SIGTAP do catálogo real para garantir o enrichment
    const real = (await import('@precisa-saude/datasus')).listBiomarkers().find((b) => b.sigtap);
    expect(real).toBeDefined();

    vi.mocked(sia.streamProducaoAmbulatorial).mockReturnValue(
      fromArray([{ PA_PROC_ID: real!.sigtap! }]) as never,
    );

    const args = parseArgs(['--uf', 'AC', '--year', '2024', '--month', '1', '--enrich-loinc']);
    const { out } = await capture(() => runSia(args));
    const parsed = JSON.parse(out) as Array<{
      biomarker: { code: string } | null;
      loinc: string | null;
      procedimento: string;
    }>;
    expect(parsed[0]!.biomarker?.code).toBe(real!.biomarker.code);
    expect(parsed[0]!.loinc).toBe(real!.loinc);
  });

  it('exige --uf, --year e --month', async () => {
    await expect(runSia(parseArgs(['--year', '2024', '--month', '1']))).rejects.toThrow(UsageError);
    await expect(runSia(parseArgs(['--uf', 'AC', '--month', '1']))).rejects.toThrow(UsageError);
    await expect(runSia(parseArgs(['--uf', 'AC', '--year', '2024']))).rejects.toThrow(UsageError);
  });

  it('--raw --limit emite apenas N registros como JSONL', async () => {
    const records = Array.from({ length: 50 }, (_, i) => ({
      PA_CODUNI: String(i),
      PA_PROC_ID: '0202010279',
    }));
    vi.mocked(sia.streamProducaoAmbulatorial).mockReturnValue(fromArray(records) as never);
    const args = parseArgs([
      '--uf',
      'SP',
      '--year',
      '2024',
      '--month',
      '1',
      '--raw',
      '--limit',
      '4',
    ]);
    const { out } = await capture(() => runSia(args));
    expect(out.trim().split('\n')).toHaveLength(4);
  });

  it('--labeled projeta via labelProducaoAmbulatorial (JSONL default)', async () => {
    vi.mocked(sia.streamProducaoAmbulatorial).mockReturnValue(
      fromArray([
        {
          PA_CBOCOD: '225125',
          PA_CMP: '202401',
          PA_CODUNI: '7530684',
          PA_PROC_ID: '0202010279',
          PA_SEXO: 'F',
          PA_UFMUN: '120040',
        },
      ]) as never,
    );
    const args = parseArgs(['--uf', 'AC', '--year', '2024', '--month', '1', '--labeled']);
    const { out } = await capture(() => runSia(args));
    const line = out.trim();
    const parsed = JSON.parse(line) as {
      competencia: { iso: string };
      sexo: { rotulo: string };
    };
    expect(parsed.competencia.iso).toBe('2024-01');
    expect(parsed.sexo.rotulo).toBe('Feminino');
  });
});
