/**
 * Suggestion utilities for typo detection and helpful error messages.
 */

import { levenshteinDistance } from '@/utils/levenshtein.js';

interface SimilarityOptions {
  maxDistance?: number;
  maxSuggestions?: number;
  caseInsensitive?: boolean;
}

interface SuggestionMatch {
  value: string;
  distance: number;
}

function normalizeForComparison(str: string, caseInsensitive: boolean): string {
  return caseInsensitive ? str.toLowerCase() : str;
}

function findMatches(
  input: string,
  candidates: readonly string[],
  maxDistance: number,
  caseInsensitive: boolean
): SuggestionMatch[] {
  const normalizedInput = normalizeForComparison(input, caseInsensitive);
  const matches: SuggestionMatch[] = [];

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeForComparison(candidate, caseInsensitive);
    const distance = levenshteinDistance(normalizedInput, normalizedCandidate);

    if (distance > 0 && distance <= maxDistance) {
      matches.push({ value: candidate, distance });
    }
  }

  return matches.sort((a, b) => a.distance - b.distance);
}

export function findSimilar(
  input: string,
  candidates: readonly string[],
  options: SimilarityOptions = {}
): string[] {
  const { maxDistance = 3, maxSuggestions = 3, caseInsensitive = true } = options;
  const matches = findMatches(input, candidates, maxDistance, caseInsensitive);
  return matches.slice(0, maxSuggestions).map((m) => m.value);
}

export function formatSuggestions(
  suggestions: readonly string[],
  options: { prefix?: string; suffix?: string } = {}
): string {
  if (suggestions.length === 0) return '';
  const { prefix = 'Did you mean: ', suffix = '?' } = options;
  return `${prefix}${suggestions.join(', ')}${suffix}`;
}

export function getSuggestion(
  input: string,
  candidates: readonly string[],
  options: SimilarityOptions & { prefix?: string; suffix?: string } = {}
): string {
  return formatSuggestions(findSimilar(input, candidates, options), options);
}

/** Most similar ids or classes suggested for a selector that matched nothing */
const MAX_SIMILAR_NAMES = 3;

/**
 * Length of the common start of two strings.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Characters they share from the start
 */
function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length++;
  return length;
}

/**
 * Length of the common end of two strings.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Characters they share from the end
 */
function commonSuffixLength(a: string, b: string): number {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) {
    length++;
  }
  return length;
}

/**
 * Names (ids or classes) similar to one that matched nothing, best first, at
 * most three: near-typos first (Levenshtein distance up to a fifth of the
 * length, at least 2), then names sharing a long end (at least a third of
 * the name, at least 4 characters), then names sharing a long start (at
 * least half: `--color-btn-inset-shadow` and `--color-bg-discussions-…` share
 * only a namespace). The end
 * ranks before the start because ids tend to name an action before the item
 * (`add-to-cart-backpack` becomes `remove-backpack` once clicked).
 *
 * @param name - Id or class that matched nothing
 * @param candidates - Ids or classes on the page
 * @returns Up to three similar names
 */
export function findSimilarNames(name: string, candidates: readonly string[]): string[] {
  const others = [...new Set(candidates)].filter((candidate) => candidate !== name);
  const maxDistance = Math.max(2, Math.floor(name.length / 5));
  const minAffix = Math.max(4, Math.ceil(name.length / 3));
  const typos = findMatches(name, others, maxDistance, false).map((match) => match.value);
  const byAffix = (length: (candidate: string) => number, min = minAffix): string[] =>
    others
      .map((candidate) => ({ candidate, length: length(candidate) }))
      .filter((entry) => entry.length >= min)
      .sort((a, b) => b.length - a.length)
      .map((entry) => entry.candidate);
  const ranked = [
    ...typos,
    ...byAffix((candidate) => commonSuffixLength(name, candidate)),
    ...byAffix(
      (candidate) => commonPrefixLength(name, candidate),
      Math.max(minAffix, Math.ceil(name.length / 2))
    ),
  ];
  return [...new Set(ranked)].slice(0, MAX_SIMILAR_NAMES);
}

/** A selector that is just one id or one class, e.g. `#save` or `.btn-primary` */
export interface SingleNameSelector {
  kind: 'id' | 'class';
  name: string;
}

/**
 * Whether a selector is a single id or class (the kind "did you mean" can
 * suggest for).
 *
 * @param selector - CSS selector
 * @returns The id or class, or null for any other selector
 */
export function parseSingleNameSelector(selector: string): SingleNameSelector | null {
  const match = /^([#.])(-?[_a-zA-Z][\w-]*)$/.exec(selector.trim());
  if (!match) return null;
  return { kind: match[1] === '#' ? 'id' : 'class', name: match[2] as string };
}
