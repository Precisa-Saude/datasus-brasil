/**
 * PKWARE Data Compression Library (DCL) Implode decoder.
 *
 * Implementa LZ77 com janela deslizante de 4096 bytes + códigos de Huffman
 * canônicos armazenados LSB-first. Usado pelo DATASUS como camada interna
 * dos arquivos `.dbc` (xBase DBF comprimido).
 *
 * Portado de referências em C e JS:
 * - Mark Adler, `blast.c` (zlib/contrib): https://github.com/madler/zlib/blob/master/contrib/blast/blast.c
 * - ConspiracyHu, `pkwdcl.js` (Unlicense): https://github.com/ConspiracyHu/diskmag-onlinification-project/blob/master/common/pkwdcl.js
 *
 * Entrada: bytes DCL-imploded puros (sem o envelope DBC).
 * Saída: `Uint8Array` com os bytes descomprimidos.
 */

const MAXBITS = 13;
const MAXWIN = 4096;
const END_CODE = 519;

/**
 * Bit lengths of literal codes, run-length encoded: each entry packs a repeat
 * count in the high 4 bits and the bit length in the low 4 bits. Expands to
 * 256 entries (one per literal byte).
 */
const LITLEN: readonly number[] = [
  11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8,
  23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11,
  8, 11, 9, 12, 8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253,
  253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173,
];

/** Bit lengths of length codes 0..15, same RLE encoding as above. */
const LENLEN: readonly number[] = [2, 35, 36, 53, 38, 23];

/** Bit lengths of distance codes 0..63, same RLE encoding. */
const DISTLEN: readonly number[] = [2, 20, 53, 230, 247, 151, 248];

/** Base length for length codes 0..15 (len = base[code] + bits(extra[code])). */
const BASE: readonly number[] = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];

/** Extra bits to read after each length code. */
const EXTRA: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

interface HuffmanTable {
  /** Number of codes of each bit length, indexed by length (0..MAXBITS). */
  count: number[];
  /** Symbols sorted by code length then code order. */
  symbol: number[];
}

/**
 * Build a canonical Huffman decode table from an RLE-encoded bit-length list.
 * Each entry in `rep` packs `(repeats << 4) | length`.
 *
 * Throws if the set of code lengths is over-subscribed (invalid). An
 * incomplete set is allowed — `decode` returns -9 if it runs off the end.
 */
function construct(rep: readonly number[]): HuffmanTable {
  const length = new Array<number>(256);
  let symbol = 0;
  let n = rep.length;

  let i = 0;
  do {
    let len = rep[i++]!;
    let left = (len >> 4) + 1;
    len &= 15;
    do {
      length[symbol++] = len;
    } while (--left);
  } while (--n);

  const totalSymbols = symbol;
  const count = new Array<number>(MAXBITS + 1).fill(0);
  const symbolTable = new Array<number>(totalSymbols);

  for (let s = 0; s < totalSymbols; s++) {
    count[length[s]!] = count[length[s]!]! + 1;
  }

  let left = 1;
  for (let len = 1; len <= MAXBITS; len++) {
    left <<= 1;
    left -= count[len]!;
    if (left < 0) {
      throw new Error(`Over-subscribed Huffman code set at length ${len}`);
    }
  }

  const offs = new Array<number>(MAXBITS + 1).fill(0);
  offs[1] = 0;
  for (let len = 1; len < MAXBITS; len++) {
    offs[len + 1] = offs[len]! + count[len]!;
  }

  for (let s = 0; s < totalSymbols; s++) {
    if (length[s] !== 0) {
      symbolTable[offs[length[s]!]!++] = s;
    }
  }

  return { count, symbol: symbolTable };
}

const LITCODE = construct(LITLEN);
const LENCODE = construct(LENLEN);
const DISTCODE = construct(DISTLEN);

/**
 * Stateful bit-level streaming decoder. Each instance is single-use —
 * `run()` consumes the input and returns the decompressed output.
 */
class ImplodeDecoder {
  private readonly inStream: Uint8Array;
  private inPtr = 0;
  private bitbuf = 0;
  private bitcnt = 0;

  private readonly window = new Uint8Array(MAXWIN);
  private next = 0;
  private first = 1;

  private readonly outStream: Uint8Array;
  private outPtr = 0;

  constructor(compressed: Uint8Array, uncompressedLength: number) {
    this.inStream = compressed;
    this.outStream = new Uint8Array(uncompressedLength);
  }

  /** Read `need` bits (1..13) LSB-first from the input stream. */
  private bits(need: number): number {
    let val = this.bitbuf;
    while (this.bitcnt < need) {
      val |= this.inStream[this.inPtr++]! << this.bitcnt;
      this.bitcnt += 8;
    }
    this.bitbuf = val >> need;
    this.bitcnt -= need;
    return val & ((1 << need) - 1);
  }

  /**
   * Huffman-decode one symbol. Bits are inverted and consumed MSB-first
   * within each byte — this matches blast.c's canonical handling. Returns
   * -9 if the code runs past MAXBITS (corrupt input).
   */
  private decode(h: HuffmanTable): number {
    let bitbuf = this.bitbuf;
    let left = this.bitcnt;
    let code = 0;
    let first = 0;
    let index = 0;
    let len = 1;
    let nextIdx = 1;

    while (true) {
      while (left-- > 0) {
        code |= (bitbuf & 1) ^ 1;
        bitbuf >>>= 1;
        const count = h.count[nextIdx++]!;
        if (code < first + count) {
          this.bitbuf = bitbuf;
          this.bitcnt = (this.bitcnt - len) & 7;
          return h.symbol[index + (code - first)]!;
        }
        index += count;
        first += count;
        first <<= 1;
        code <<= 1;
        len++;
      }
      left = MAXBITS + 1 - len;
      if (left === 0) break;
      bitbuf = this.inStream[this.inPtr++]!;
      if (left > 8) left = 8;
    }
    return -9;
  }

  private flushWindow(): void {
    for (let i = 0; i < this.next; i++) {
      this.outStream[this.outPtr++] = this.window[i]!;
    }
    this.next = 0;
    this.first = 0;
  }

  run(): Uint8Array {
    const lit = this.bits(8);
    if (lit > 1) {
      throw new Error(`DCL Implode: invalid lit flag ${lit} (expected 0 or 1)`);
    }
    const dict = this.bits(8);
    if (dict < 4 || dict > 6) {
      throw new Error(`DCL Implode: invalid dict flag ${dict} (expected 4, 5, or 6)`);
    }

    while (true) {
      if (this.bits(1)) {
        const lenSymbol = this.decode(LENCODE);
        if (lenSymbol < 0) {
          throw new Error(`DCL Implode: Huffman decode error in length code (${lenSymbol})`);
        }
        let len = BASE[lenSymbol]! + this.bits(EXTRA[lenSymbol]!);
        if (len === END_CODE) break;

        const distShift = len === 2 ? 2 : dict;
        const distSymbol = this.decode(DISTCODE);
        if (distSymbol < 0) {
          throw new Error(`DCL Implode: Huffman decode error in distance code (${distSymbol})`);
        }
        const dist = (distSymbol << distShift) + this.bits(distShift) + 1;

        if (this.first && dist > this.next) {
          throw new Error(
            `DCL Implode: distance ${dist} exceeds bytes produced so far (${this.next})`,
          );
        }

        do {
          let to = this.next;
          let from = to - dist;
          let copy = MAXWIN;
          if (this.next < dist) {
            from += copy;
            copy = dist;
          }
          copy -= this.next;
          if (copy > len) copy = len;
          len -= copy;
          this.next += copy;
          do {
            this.window[to++] = this.window[from++]!;
          } while (--copy);
          if (this.next === MAXWIN) this.flushWindow();
        } while (len !== 0);
      } else {
        const symbol = lit ? this.decode(LITCODE) : this.bits(8);
        if (symbol < 0) {
          throw new Error(`DCL Implode: Huffman decode error in literal code (${symbol})`);
        }
        this.window[this.next++] = symbol;
        if (this.next === MAXWIN) this.flushWindow();
      }
    }

    this.flushWindow();
    return this.outStream.slice(0, this.outPtr);
  }
}

/**
 * Decompress a PKWARE DCL Implode stream.
 *
 * @param compressed - raw DCL-imploded bytes (no DBC envelope)
 * @param uncompressedLength - expected output size in bytes (must be known up front)
 * @returns decompressed buffer
 * @throws if the input is malformed or the Huffman decode runs off the end
 */
export function implodeDecompress(compressed: Uint8Array, uncompressedLength: number): Uint8Array {
  const decoder = new ImplodeDecoder(compressed, uncompressedLength);
  return decoder.run();
}
