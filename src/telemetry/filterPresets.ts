/**
 * Predefined filter presets for common network queries.
 *
 * Provides convenient shortcuts for frequently used filter combinations.
 */

import { CommandError } from '@/ui/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { getSuggestion } from '@/utils/suggestions.js';

/**
 * Filter preset definition.
 */
export interface FilterPreset {
  /** Preset name (used in --preset option) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Filter DSL string */
  filter: string;
}

/**
 * Available filter presets.
 */
export const FILTER_PRESETS: Record<string, FilterPreset> = {
  errors: {
    name: 'errors',
    description: 'Failed requests (4xx and 5xx status codes)',
    filter: 'status-code:>=400',
  },
  api: {
    name: 'api',
    description: 'API requests (XHR and Fetch)',
    filter: 'resource-type:XHR,Fetch',
  },
  large: {
    name: 'large',
    description: 'Large responses (>1MB)',
    filter: 'larger-than:1MB',
  },
  cached: {
    name: 'cached',
    description: 'Cached responses',
    filter: 'is:from-cache',
  },
  documents: {
    name: 'documents',
    description: 'HTML documents only',
    filter: 'resource-type:Document',
  },
  media: {
    name: 'media',
    description: 'Images, video, and audio',
    filter: 'resource-type:Image,Media',
  },
  scripts: {
    name: 'scripts',
    description: 'JavaScript files',
    filter: 'resource-type:Script',
  },
  pending: {
    name: 'pending',
    description: 'In-progress requests (no response yet)',
    filter: 'is:running',
  },
};

/**
 * Resolve a preset name to its filter string.
 *
 * @param name - Preset name
 * @returns Filter DSL string
 * @throws CommandError if preset not found
 */
export function resolvePreset(name: string): string {
  const preset = FILTER_PRESETS[name.toLowerCase()];
  if (!preset) {
    const presetNames = Object.keys(FILTER_PRESETS);
    const typoSuggestion = getSuggestion(name, presetNames);
    const suggestion = typoSuggestion || `Available presets: ${presetNames.join(', ')}`;
    throw new CommandError(
      `Unknown preset: "${name}"`,
      { suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return preset.filter;
}

/**
 * Get all preset names for CLI choices.
 *
 * @returns Array of preset names
 */
export function getPresetNames(): string[] {
  return Object.keys(FILTER_PRESETS);
}
