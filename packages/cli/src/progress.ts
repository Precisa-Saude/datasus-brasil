/**
 * Renderizador de progresso de download para o CLI.
 *
 * Em TTY: barra interativa atualizada in-place via `\r` com %, bytes,
 * total e throughput. Em não-TTY (pipe, log): uma linha final de resumo
 * — evita encher logs com updates parciais.
 *
 * Não depende de nenhuma lib externa.
 */

import type { ProgressEvent } from '@precisa-saude/datasus';

export interface ProgressReporterOptions {
  /** Stream de saída (default: process.stderr). Injetável pra testes. */
  stream?: NodeJS.WritableStream & { isTTY?: boolean };
}

const BAR_WIDTH = 24;

/**
 * Retorna um callback compatível com `DownloadOptions.onProgress` que
 * renderiza progresso numa stream (stderr por default).
 */
export function createProgressReporter(
  label: string,
  options: ProgressReporterOptions = {},
): (event: ProgressEvent) => void {
  const stream = options.stream ?? process.stderr;
  const isTTY = Boolean(stream.isTTY);
  // `startTime` é capturado no primeiro evento (não na criação do
  // reporter) pra que delays de setup FTP não inflem o denominador e
  // subestimem a velocidade reportada.
  let startTime: null | number = null;
  let lastLineLength = 0;
  let finished = false;

  const renderLine = (line: string): void => {
    const padded = line.length < lastLineLength ? line.padEnd(lastLineLength) : line;
    stream.write(`\r${padded}`);
    lastLineLength = line.length;
  };

  const finishLine = (): void => {
    if (lastLineLength > 0) {
      stream.write('\n');
      lastLineLength = 0;
    }
    finished = true;
  };

  return (event) => {
    if (finished) return;

    if (event.fromCache) {
      stream.write(`${label} (cache, ${formatBytes(event.transferred)})\n`);
      finished = true;
      return;
    }

    if (startTime === null) startTime = Date.now();
    const elapsedSec = (Date.now() - startTime) / 1000;
    const speed = elapsedSec > 0 ? event.transferred / elapsedSec : 0;
    const transferredStr = formatBytes(event.transferred);
    const speedStr = `${formatBytes(speed)}/s`;

    if (event.total !== null && event.total > 0) {
      const ratio = Math.min(1, event.transferred / event.total);
      const complete = event.transferred >= event.total;
      const totalStr = formatBytes(event.total);

      if (isTTY) {
        const filled = Math.round(ratio * BAR_WIDTH);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        const pct = Math.round(ratio * 100)
          .toString()
          .padStart(3);
        renderLine(`${label} [${bar}] ${pct}%  ${transferredStr} / ${totalStr}  ${speedStr}`);
        if (complete) finishLine();
      } else if (complete) {
        stream.write(`${label} ${totalStr} em ${elapsedSec.toFixed(1)}s (${speedStr})\n`);
        finished = true;
      }
      return;
    }

    // Tamanho desconhecido — mostra apenas bytes transferidos.
    if (isTTY) {
      renderLine(`${label}  ${transferredStr}  ${speedStr}`);
    }
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
