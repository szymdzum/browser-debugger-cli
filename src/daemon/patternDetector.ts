/**
 * Pattern detector for identifying verbose CDP usage.
 *
 * Tracks CDP command execution and detects patterns that indicate
 * agents are using verbose approaches when high-level alternatives exist.
 */

import { findPatternsForMethod, type PatternDefinition } from './patternDefinitions.js';

/**
 * Pattern detection result with hint information.
 */
export interface PatternDetectionResult {
  /** Whether a hint should be shown */
  shouldShow: boolean;
  /** Pattern whose hint should be shown */
  pattern?: PatternDefinition;
}

/**
 * Pattern detector for tracking CDP usage and suggesting alternatives.
 *
 * Counts calls per pattern, so related methods (e.g. `Network.getCookies` and
 * `Network.getAllCookies`) share one count. Once a pattern reaches its threshold
 * its hint is shown at most `MAX_HINTS_PER_PATTERN` times. When several patterns
 * qualify, the one with the highest threshold wins as the most specific signal.
 */
export class PatternDetector {
  private static readonly MAX_HINTS_PER_PATTERN = 3;
  private readonly patternCounts: Map<string, number> = new Map();
  private readonly hintShownCounts: Map<string, number> = new Map();

  /**
   * Track a CDP command execution.
   *
   * @param method - CDP method that was executed (case-insensitive, e.g. "Runtime.evaluate")
   * @returns Detection result indicating whether a hint should be shown
   */
  trackCommand(method: string): PatternDetectionResult {
    let selected: PatternDefinition | undefined;

    for (const pattern of findPatternsForMethod(method)) {
      const count = (this.patternCounts.get(pattern.name) ?? 0) + 1;
      this.patternCounts.set(pattern.name, count);
      if (count < pattern.threshold || !this.canShowHint(pattern)) continue;
      if (!selected || pattern.threshold > selected.threshold) {
        selected = pattern;
      }
    }

    if (!selected) {
      return { shouldShow: false };
    }
    this.hintShownCounts.set(selected.name, (this.hintShownCounts.get(selected.name) ?? 0) + 1);
    return { shouldShow: true, pattern: selected };
  }

  /**
   * Check whether a pattern's hint is still under its display limit.
   *
   * @param pattern - Pattern to check
   * @returns True if the hint may be shown again
   */
  private canShowHint(pattern: PatternDefinition): boolean {
    return (this.hintShownCounts.get(pattern.name) ?? 0) < PatternDetector.MAX_HINTS_PER_PATTERN;
  }
}
