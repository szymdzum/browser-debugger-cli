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
  /** Pattern that was detected */
  pattern?: PatternDefinition;
  /** How many times this hint has been shown */
  shownCount?: number;
}

/**
 * Pattern detector for tracking CDP usage and suggesting alternatives.
 *
 * Maintains state for pattern occurrence counts and hint display limits.
 * Designed to provide helpful guidance without overwhelming users.
 */
export class PatternDetector {
  private readonly methodCounts: Map<string, number> = new Map();
  private readonly hintShownCounts: Map<string, number> = new Map();
  private readonly maxHintsPerPattern = 3;

  /**
   * Track a CDP command execution.
   *
   * Records the command and checks if any patterns are triggered.
   * Returns detection result indicating if a hint should be shown.
   *
   * @param method - CDP method that was executed (e.g., "Runtime.evaluate")
   * @returns Detection result with hint information
   */
  trackCommand(method: string): PatternDetectionResult {
    const currentCount = (this.methodCounts.get(method) ?? 0) + 1;
    this.methodCounts.set(method, currentCount);

    const matchingPatterns = findPatternsForMethod(method);

    for (const pattern of matchingPatterns) {
      if (currentCount >= pattern.threshold) {
        const shownCount = this.hintShownCounts.get(pattern.name) ?? 0;

        if (shownCount < this.maxHintsPerPattern) {
          this.hintShownCounts.set(pattern.name, shownCount + 1);
          return {
            shouldShow: true,
            pattern,
            shownCount: shownCount + 1,
          };
        }
      }
    }

    return { shouldShow: false };
  }

  /**
   * Reset all pattern tracking state.
   *
   * Useful for testing or when starting a fresh analysis.
   */
  reset(): void {
    this.methodCounts.clear();
    this.hintShownCounts.clear();
  }

  /**
   * Get current method count for a specific CDP method.
   *
   * @param method - CDP method name
   * @returns Number of times method has been called
   */
  getMethodCount(method: string): number {
    return this.methodCounts.get(method) ?? 0;
  }

  /**
   * Get hint shown count for a specific pattern.
   *
   * @param patternName - Pattern identifier
   * @returns Number of times hint has been shown for this pattern
   */
  getHintShownCount(patternName: string): number {
    return this.hintShownCounts.get(patternName) ?? 0;
  }
}
