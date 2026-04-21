/**
 * @precisa-saude/datasus-dbc — decoder puro TS/JS de arquivos `.dbc` do DATASUS.
 *
 * O formato DBC é um `.dbf` xBase com o payload comprimido via PKWARE DCL Implode.
 * Este pacote expõe três camadas, de baixo para alto nível:
 *
 * - `implodeDecompress(compressed, uncompressedLength)` — descompressão pura DCL Implode
 * - `dbcToDbf(dbc)` — parse do header DBC + descompressão → bytes de DBF completo
 * - `readDbcRecords(source)` — leitura streaming de registros como objetos JS
 *
 * Todas as APIs retornam dados prontos para `JSON.stringify`.
 *
 * Referências:
 * - Mark Adler, `blast.c`: https://github.com/madler/zlib/blob/master/contrib/blast/blast.c
 * - Daniela Petruzalek, `DBC_FORMAT.md`: https://github.com/danicat/read.dbc/blob/master/DBC_FORMAT.md
 *
 * Implementação a partir de M1 (PRE-198).
 */

export const VERSION = '0.1.0';
