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
