/**
 * Task-to-command mapping definitions for agent discovery.
 *
 * Provides intent-based guidance mapping common automation tasks
 * to efficient high-level commands with CDP alternatives.
 */

/**
 * Task mapping from intent to command.
 */
export interface TaskMapping {
  /** High-level commands that accomplish this task */
  commands: string[];
  /** Human-readable task description */
  description: string;
  /** CDP alternative method(s) */
  cdpAlternative: string;
}

/**
 * Complete task mapping registry.
 *
 * Maps common automation intents to optimal command patterns.
 */
export const TASK_MAPPINGS: Record<string, TaskMapping> = {
  capture_screenshot: {
    commands: ['dom screenshot'],
    description: 'Capture full page screenshot to file',
    cdpAlternative: 'Page.captureScreenshot',
  },

  query_dom_elements: {
    commands: ['dom query'],
    description: 'Query DOM elements by CSS selector',
    cdpAlternative: 'Runtime.evaluate with querySelector',
  },

  execute_javascript: {
    commands: ['dom eval'],
    description: 'Execute arbitrary JavaScript in page context',
    cdpAlternative: 'Runtime.evaluate',
  },

  fill_form_input: {
    commands: ['dom fill'],
    description: 'Fill form input field by selector',
    cdpAlternative: 'Runtime.evaluate with value assignment',
  },

  click_element: {
    commands: ['dom click'],
    description: 'Click element by selector',
    cdpAlternative: 'Runtime.evaluate with click()',
  },

  get_element_details: {
    commands: ['dom get'],
    description: 'Get detailed element information',
    cdpAlternative: 'Runtime.evaluate with property extraction',
  },

  accessibility_tree: {
    commands: ['dom a11y'],
    description: 'Get accessibility tree for page or element',
    cdpAlternative: 'Accessibility.getFullAXTree',
  },

  export_har: {
    commands: ['network har'],
    description: 'Export network traffic as HAR file',
    cdpAlternative: 'Network domain events collection',
  },

  get_cookies: {
    commands: ['network getCookies'],
    description: 'Get all cookies for current page',
    cdpAlternative: 'Network.getAllCookies',
  },

  get_request_headers: {
    commands: ['network headers'],
    description: 'Get HTTP headers for specific request',
    cdpAlternative: 'Network.getResponseBody + event data',
  },

  query_console_logs: {
    commands: ['console query'],
    description: 'Query and filter console log messages',
    cdpAlternative: 'Runtime.consoleAPICalled events',
  },

  preview_data: {
    commands: ['peek'],
    description: 'Preview collected network and console data',
    cdpAlternative: 'Multiple IPC queries to worker state',
  },

  live_monitoring: {
    commands: ['peek --follow', 'tail'],
    description: 'Monitor data collection in real-time',
    cdpAlternative: 'CDP event subscriptions with custom handler',
  },

  get_full_details: {
    commands: ['details network', 'details console'],
    description: 'Get complete request/response or console message details',
    cdpAlternative: 'Worker state query + response body fetch',
  },

  check_session_status: {
    commands: ['status'],
    description: 'Check current session and daemon status',
    cdpAlternative: 'IPC ping + process checks',
  },
};

/**
 * Get task mapping by key.
 *
 * @param taskKey - Task identifier
 * @returns Task mapping if found, undefined otherwise
 */
export function getTaskMapping(taskKey: string): TaskMapping | undefined {
  return TASK_MAPPINGS[taskKey];
}

/**
 * Get all task mappings.
 *
 * @returns Complete task mapping registry
 */
export function getAllTaskMappings(): Record<string, TaskMapping> {
  return TASK_MAPPINGS;
}

/**
 * Search task mappings by description keyword.
 *
 * @param keyword - Search term (case-insensitive)
 * @returns Matching task mappings with keys
 */
export function searchTaskMappings(keyword: string): Array<{ key: string; mapping: TaskMapping }> {
  const lowerKeyword = keyword.toLowerCase();
  return Object.entries(TASK_MAPPINGS)
    .filter(([, mapping]) => mapping.description.toLowerCase().includes(lowerKeyword))
    .map(([key, mapping]) => ({ key, mapping }));
}
