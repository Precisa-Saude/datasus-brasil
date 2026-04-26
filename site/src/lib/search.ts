/**
 * Normaliza texto para busca: minúsculas e remove acentos
 * combinantes (Unicode U+0300–U+036F).
 */
export const normalizeText = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Filtro do `cmdk` que casa do início de cada palavra (não substring
 * arbitrária). Retorna 1 (match) ou 0 (no match).
 *
 * @param minChars mínimo de caracteres antes de filtrar (default 0)
 */
export const wordStartFilter =
  (minChars = 0) =>
  (text: string, search: string): number => {
    if (!search || search.length < minChars) return 1;
    const haystack = normalizeText(text);
    const needle = normalizeText(search);
    if (haystack.startsWith(needle)) return 1;
    return haystack.includes(` ${needle}`) ? 1 : 0;
  };
