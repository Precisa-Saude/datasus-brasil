/**
 * Dispatch do CLI — sem process.exit nem handlers globais, pra ser
 * testável. O bin entry (`index.ts`) é quem traduz o resultado em exit
 * codes e serializa erros no stderr.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, UsageError } from './args.js';
import { CNES_USAGE, runCnes } from './commands/cnes.js';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
export const VERSION = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

export const ROOT_USAGE = `datasus-brasil — CLI para microdados DATASUS

Uso:
  datasus-brasil <comando> [flags]

Comandos:
  cnes     Top tipos de estabelecimento de saúde (CNES-ST).

Globais:
  -h, --help        Mostra esta ajuda (ou ajuda do comando).
  -v, --version     Mostra a versão.

Flags de subset (todos os comandos):
  --limit N    Para a leitura após N registros (bom pra smoke test).
  --raw        Emite registros brutos em JSONL em vez da agregação.

Exemplos:
  datasus-brasil cnes --uf AC --year 2024 --month 1
  datasus-brasil cnes --uf SP --year 2024 --month 1 --format jsonl
  datasus-brasil cnes --uf AC --year 2024 --month 1 --raw --limit 10

Ver '<comando> --help' para detalhes de cada comando.`;

export interface DispatchResult {
  /** Mensagem a ser impressa no stdout antes de retornar (help/version). */
  message?: string;
}

/**
 * Despacha o comando a partir do argv já sem o prefixo node/script.
 * Retorna normalmente em caso de sucesso; lança `UsageError` para erros
 * de uso (exit 2) e outras exceções para falhas de runtime (exit 1).
 */
export async function dispatch(argv: string[]): Promise<DispatchResult> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  const wantsHelp = args.bools.has('help') || args.bools.has('h');

  if (command === undefined || command === '--help' || command === '-h') {
    return { message: ROOT_USAGE };
  }
  if (command === '--version' || command === '-v') {
    return { message: VERSION };
  }

  switch (command) {
    case 'cnes':
      if (wantsHelp) return { message: CNES_USAGE };
      await runCnes(args);
      return {};
    default:
      if (command.startsWith('-')) {
        throw new UsageError(
          `Flags devem vir depois do comando. Uso: datasus-brasil <comando> [flags] (recebido: '${command}')`,
        );
      }
      throw new UsageError(`Comando desconhecido: '${command}'`);
  }
}
