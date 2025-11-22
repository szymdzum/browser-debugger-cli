/**
 * Decision tree definitions for intent-based command discovery.
 *
 * Provides structured guidance trees that help agents navigate
 * from high-level intents to specific commands through question-based flow.
 */

/**
 * Decision tree node representing a question and actions.
 */
export interface DecisionTreeNode {
  /** Question to determine next action */
  question: string;
  /** Command to execute if answer is yes */
  yesCommand: string;
  /** Next action if answer is no (command name or "next" to continue) */
  noAction: string;
}

/**
 * Complete decision tree for a specific intent domain.
 */
export interface DecisionTree {
  /** High-level intent this tree addresses */
  intent: string;
  /** Ordered sequence of decision nodes */
  steps: DecisionTreeNode[];
}

/**
 * Decision tree registry mapping intent domains to guidance flows.
 */
export const DECISION_TREES: Record<string, DecisionTree> = {
  dom_interaction: {
    intent: 'Interact with page elements and DOM',
    steps: [
      {
        question: 'Need to capture a screenshot?',
        yesCommand: 'dom screenshot',
        noAction: 'next',
      },
      {
        question: 'Need to query/find elements?',
        yesCommand: 'dom query',
        noAction: 'next',
      },
      {
        question: 'Need to get detailed element information?',
        yesCommand: 'dom get',
        noAction: 'next',
      },
      {
        question: 'Need to fill form input?',
        yesCommand: 'dom fill',
        noAction: 'next',
      },
      {
        question: 'Need to click an element?',
        yesCommand: 'dom click',
        noAction: 'next',
      },
      {
        question: 'Need to press a key (Enter, Tab, Escape)?',
        yesCommand: 'dom pressKey',
        noAction: 'next',
      },
      {
        question: 'Need to execute custom JavaScript?',
        yesCommand: 'dom eval',
        noAction: 'next',
      },
      {
        question: 'Need accessibility tree?',
        yesCommand: 'dom a11y',
        noAction: 'cdp',
      },
    ],
  },

  network_inspection: {
    intent: 'Inspect network traffic and requests',
    steps: [
      {
        question: 'Need to export all traffic as HAR file?',
        yesCommand: 'network har',
        noAction: 'next',
      },
      {
        question: 'Need to get cookies?',
        yesCommand: 'network getCookies',
        noAction: 'next',
      },
      {
        question: 'Need HTTP headers for specific request?',
        yesCommand: 'network headers',
        noAction: 'next',
      },
      {
        question: 'Need full request/response details?',
        yesCommand: 'details network',
        noAction: 'cdp',
      },
    ],
  },

  console_inspection: {
    intent: 'Inspect console logs and messages',
    steps: [
      {
        question: 'Need current page errors/warnings with deduplication?',
        yesCommand: 'console',
        noAction: 'next',
      },
      {
        question: 'Need messages from all page loads (history)?',
        yesCommand: 'console --history',
        noAction: 'next',
      },
      {
        question: 'Need to stream console messages in real-time?',
        yesCommand: 'console --follow',
        noAction: 'next',
      },
      {
        question: 'Need all messages chronologically?',
        yesCommand: 'console --list',
        noAction: 'next',
      },
      {
        question: 'Need full console message details?',
        yesCommand: 'details console',
        noAction: 'cdp',
      },
    ],
  },

  data_monitoring: {
    intent: 'Monitor and preview collected data',
    steps: [
      {
        question: 'Need real-time live updates?',
        yesCommand: 'peek --follow',
        noAction: 'next',
      },
      {
        question: 'Need continuous monitoring (like tail -f)?',
        yesCommand: 'tail',
        noAction: 'next',
      },
      {
        question: 'Need quick preview of recent data?',
        yesCommand: 'peek',
        noAction: 'next',
      },
      {
        question: 'Need detailed item inspection?',
        yesCommand: 'details',
        noAction: 'status',
      },
    ],
  },

  session_management: {
    intent: 'Manage browser session lifecycle',
    steps: [
      {
        question: 'Starting a new session?',
        yesCommand: 'bdg <url>',
        noAction: 'next',
      },
      {
        question: 'Need to check session status?',
        yesCommand: 'status',
        noAction: 'next',
      },
      {
        question: 'Ready to end session and save output?',
        yesCommand: 'stop',
        noAction: 'next',
      },
      {
        question: 'Need to clean up stale sessions?',
        yesCommand: 'cleanup',
        noAction: 'help',
      },
    ],
  },
};

/**
 * Get all decision trees.
 *
 * @returns Complete decision tree registry
 */
export function getAllDecisionTrees(): Record<string, DecisionTree> {
  return DECISION_TREES;
}
