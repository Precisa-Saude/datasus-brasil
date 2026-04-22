/**
 * datasus-brasil CLI — bin entry.
 *
 * Delega a lógica pro `dispatch` em `main.ts` e traduz o resultado em
 * exit codes. Mantenha este arquivo mínimo — está excluído de coverage.
 */

import { UsageError } from './args.js';
import { dispatch } from './main.js';

dispatch(process.argv.slice(2))
  .then(({ message }) => {
    if (message !== undefined) {
      process.stdout.write(`${message}\n`);
    }
  })
  .catch((err: unknown) => {
    if (err instanceof UsageError) {
      process.stderr.write(`erro: ${err.message}\n\nExecute 'datasus-brasil --help' para uso.\n`);
      process.exit(2);
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`erro: ${message}\n`);
    process.exit(1);
  });
