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

  press_key: {
    commands: ['dom pressKey'],
    description: 'Press keyboard key on element (Enter, Tab, Escape, etc.)',
    cdpAlternative: 'Input.dispatchKeyEvent',
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

  inspect_console: {
    commands: ['console'],
    description:
      'Smart console inspection (current page, errors/warnings deduplicated, objects expanded)',
    cdpAlternative: 'Runtime.consoleAPICalled events + Runtime.getProperties',
  },

  console_history: {
    commands: ['console --history'],
    description: 'Show console messages from all page loads',
    cdpAlternative: 'Runtime.consoleAPICalled events',
  },

  stream_console: {
    commands: ['console --follow'],
    description: 'Stream console messages in real-time',
    cdpAlternative: 'Runtime.consoleAPICalled event subscription',
  },

  list_console_messages: {
    commands: ['console --list'],
    description: 'List all console messages chronologically',
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

  cleanup_session: {
    commands: ['cleanup'],
    description: 'Clean up stale session files and processes',
    cdpAlternative: 'Manual process termination + file cleanup',
  },

  stop_session: {
    commands: ['stop'],
    description: 'Stop session and write collected telemetry',
    cdpAlternative: 'Target.closeTarget + file write',
  },

  submit_form: {
    commands: ['dom submit'],
    description: 'Submit form by clicking submit button and waiting for completion',
    cdpAlternative: 'Runtime.evaluate with form.submit() or button.click()',
  },

  navigate_to_url: {
    commands: ['bdg <url>'],
    description: 'Start session and navigate to URL',
    cdpAlternative: 'Page.navigate',
  },

  filter_network_requests: {
    commands: ['network list --filter', 'network list --preset'],
    description: 'Filter network requests by type, status, or preset',
    cdpAlternative: 'Network domain events with client-side filtering',
  },

  get_network_details: {
    commands: ['details network <id>'],
    description: 'Get full request/response details including body',
    cdpAlternative: 'Network.getResponseBody',
  },

  get_document_headers: {
    commands: ['network document'],
    description: 'Show main HTML document request headers (shortcut for document request)',
    cdpAlternative: 'Network.requestWillBeSent + Network.responseReceived for Document type',
  },
};

/**
 * Get all task mappings.
 *
 * @returns Complete task mapping registry
 */
export function getAllTaskMappings(): Record<string, TaskMapping> {
  return TASK_MAPPINGS;
}
