/**
 * Levenshtein distance algorithm for fuzzy string matching.
 *
 * Calculates the minimum number of single-character edits (insertions,
 * deletions, or substitutions) required to change one string into another.
 *
 * Used for providing helpful suggestions when users mistype command names,
 * method names, or other identifiers.
 */

/**
 * Calculate Levenshtein distance between two strings.
 *
 * The distance represents the minimum number of single-character edits needed
 * to transform str1 into str2.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance between the strings
 *
 * @example
 * ```typescript
 * levenshteinDistance('kitten', 'sitting'); // 3
 * levenshteinDistance('saturday', 'sunday'); // 3
 * levenshteinDistance('hello', 'hello'); // 0
 * ```
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  const firstRow = matrix[0];
  if (firstRow) {
    for (let j = 0; j <= len2; j++) {
      firstRow[j] = j;
    }
  }

  for (let i = 1; i <= len1; i++) {
    const currentRow = matrix[i];
    if (!currentRow) continue;

    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const deletion = (matrix[i - 1]?.[j] ?? 0) + 1;
      const insertion = (currentRow[j - 1] ?? 0) + 1;
      const substitution = (matrix[i - 1]?.[j - 1] ?? 0) + cost;
      currentRow[j] = Math.min(deletion, insertion, substitution);
    }
  }

  return matrix[len1]?.[len2] ?? 0;
}
