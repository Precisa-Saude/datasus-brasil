/**
 * Parser mínimo de argumentos — sem lib externa.
 * Suporta:
 *   --flag valor
 *   --flag=valor
 *   --bool
 *   -h, --help
 */

export interface ParsedArgs {
  bools: Set<string>;
  opts: Map<string, string>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const bools = new Set<string>();
  const opts = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        opts.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !looksLikeFlag(next)) {
          opts.set(key, next);
          i++;
        } else {
          bools.add(key);
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1 && !isNegativeNumber(arg)) {
      // POSIX-style combined short flags: `-vh` => bools {v, h}.
      for (const ch of arg.slice(1)) bools.add(ch);
    } else {
      positional.push(arg);
    }
  }

  return { bools, opts, positional };
}

function isNegativeNumber(s: string): boolean {
  return /^-\d/.test(s);
}

function looksLikeFlag(s: string): boolean {
  if (s.startsWith('--')) return true;
  if (s.startsWith('-') && s.length > 1 && !isNegativeNumber(s)) return true;
  return false;
}

export function requireOpt(args: ParsedArgs, name: string): string {
  const v = args.opts.get(name);
  if (v === undefined || v === '') {
    throw new UsageError(`Flag obrigatória ausente: --${name}`);
  }
  return v;
}

export function requireInt(args: ParsedArgs, name: string): number {
  const raw = requireOpt(args, name);
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new UsageError(`--${name} deve ser inteiro, recebido: '${raw}'`);
  }
  return n;
}

export function optInt(args: ParsedArgs, name: string, fallback: number): number {
  const raw = args.opts.get(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new UsageError(`--${name} deve ser inteiro, recebido: '${raw}'`);
  }
  return n;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
