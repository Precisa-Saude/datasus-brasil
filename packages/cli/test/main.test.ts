import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsageError } from '../src/args.js';
import { dispatch, ROOT_USAGE, VERSION } from '../src/main.js';

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

async function* empty<T>(): AsyncIterable<T> {
  // nada a emitir
}

describe('dispatch', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('retorna ROOT_USAGE sem argumentos', async () => {
    expect(await dispatch([])).toEqual({ message: ROOT_USAGE });
  });

  it('retorna ROOT_USAGE com --help', async () => {
    expect(await dispatch(['--help'])).toEqual({ message: ROOT_USAGE });
    expect(await dispatch(['-h'])).toEqual({ message: ROOT_USAGE });
  });

  it('retorna VERSION com --version/-v', async () => {
    expect(await dispatch(['--version'])).toEqual({ message: VERSION });
    expect(await dispatch(['-v'])).toEqual({ message: VERSION });
  });

  it('retorna ajuda de subcomando com cnes --help', async () => {
    const result = await dispatch(['cnes', '--help']);
    expect(result.message).toContain('datasus-brasil cnes');
  });

  it('lança UsageError para comando desconhecido', async () => {
    await expect(dispatch(['foobar'])).rejects.toThrow(UsageError);
    await expect(dispatch(['foobar'])).rejects.toThrow(/Comando desconhecido/);
  });

  it('despacha cnes para o comando real', async () => {
    vi.mocked(cnes.streamEstabelecimentos).mockReturnValue(empty() as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await dispatch(['cnes', '--uf', 'AC', '--year', '2024', '--month', '1']);
    expect(cnes.streamEstabelecimentos).toHaveBeenCalledOnce();
  });
});
