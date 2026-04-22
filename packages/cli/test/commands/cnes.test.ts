import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs, UsageError } from '../../src/args.js';
import { runCnes } from '../../src/commands/cnes.js';

vi.mock('@precisa-saude/datasus', async (importActual) => {
  const actual = await importActual<typeof import('@precisa-saude/datasus')>();
  return {
    ...actual,
    cnes: {
      loadEstabelecimentos: vi.fn(),
      loadProfissionais: vi.fn(),
      streamEstabelecimentos: vi.fn(),
      streamProfissionais: vi.fn(),
    },
  };
});

const { cnes } = await import('@precisa-saude/datasus');

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

describe('runCnes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('agrega top-N tipos de unidade com label pt-BR via streaming', async () => {
    vi.mocked(cnes.streamEstabelecimentos).mockReturnValue(
      fromArray([{ TP_UNID: '01' }, { TP_UNID: '01' }, { TP_UNID: '02' }]) as never,
    );

    const args = parseArgs(['--uf', 'AC', '--year', '2024', '--month', '1', '--top', '2']);
    const { out } = await capture(() => runCnes(args));

    expect(cnes.streamEstabelecimentos).toHaveBeenCalledWith(
      expect.objectContaining({
        ftp: expect.objectContaining({ onProgress: expect.any(Function) }) as object,
        month: 1,
        uf: 'AC',
        year: 2024,
      }) as object,
    );
    const parsed = JSON.parse(out) as Array<{ count: number; key: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.count).toBe(2);
  });

  it('mapeia código desconhecido pra "Desconhecido"', async () => {
    vi.mocked(cnes.streamEstabelecimentos).mockReturnValue(fromArray([{ TP_UNID: 'ZZ' }]) as never);
    const args = parseArgs(['--uf', 'AC', '--year', '2024', '--month', '1']);
    const { out } = await capture(() => runCnes(args));
    const parsed = JSON.parse(out) as Array<{ count: number; key: string }>;
    expect(parsed[0]!.key).toBe('Desconhecido');
  });

  it('exige flags obrigatórias', async () => {
    const args = parseArgs(['--uf', 'AC']);
    await expect(runCnes(args)).rejects.toThrow(UsageError);
  });

  it('--raw --limit emite apenas N registros como JSONL', async () => {
    const records = Array.from({ length: 50 }, (_, i) => ({ CNES: String(i), TP_UNID: '01' }));
    vi.mocked(cnes.streamEstabelecimentos).mockReturnValue(fromArray(records) as never);
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
    const { out } = await capture(() => runCnes(args));
    expect(out.trim().split('\n')).toHaveLength(4);
  });
});
