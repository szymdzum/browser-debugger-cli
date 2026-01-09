/**
 * Session-related formatting helpers for landing page sections.
 *
 * Provides well-structured, TSDoc'd helpers for building each section
 * of the landing page, organized by priority (high-level commands first).
 */

import { section } from '@/ui/formatting.js';

/**
 * Builds the common tasks section showing task-to-command mappings.
 *
 * Provides agents with clear intent-to-command examples.
 *
 * @returns Formatted common tasks section
 */
export function buildCommonTasksSection(): string {
  return section('Common Tasks:', [
    'Screenshot    bdg dom screenshot output.png',
    'Fill forms    bdg dom fill "#email" "test@test.com"',
    'Click button  bdg dom click "button.submit"',
    'Press Enter   bdg dom pressKey "input" Enter',
    'Query DOM     bdg dom query "article h2"',
    'Get cookies   bdg network getCookies',
    'Export HAR    bdg network har output.har',
  ]);
}

/**
 * Builds the domain commands section with expanded command coverage.
 *
 * Shows all 12+ high-level commands organized by domain (DOM, Network, Console).
 * Previously showed only 2 commands, now provides comprehensive coverage.
 *
 * @returns Formatted domain commands section
 */
export function buildDomainCommandsSection(): string {
  return section('Domain Commands:', [
    'DOM:',
    '  bdg dom query <selector>          Query elements (returns JSON)',
    '  bdg dom get <selector|index>      Get element details',
    '  bdg dom eval <javascript>         Execute JavaScript in page context',
    '  bdg dom screenshot [path]         Capture full page screenshot',
    '  bdg dom fill <selector> <value>   Fill form input',
    '  bdg dom click <selector>          Click element',
    '  bdg dom pressKey <selector> <key> Press key (Enter, Tab, Escape, etc.)',
    '  bdg dom a11y [selector]           Accessibility tree',
    '',
    'Network:',
    '  bdg network har [path]            Export HTTP Archive (HAR)',
    '  bdg network getCookies            List all cookies',
    '  bdg network headers <id>          HTTP headers for request',
    '',
    'Console:',
    '  bdg console [options]             Query console logs',
  ]);
}

/**
 * Builds the live monitoring section.
 *
 * Shows commands for real-time data inspection during active sessions.
 *
 * @returns Formatted live monitoring section
 */
export function buildLiveMonitoringSection(): string {
  return section('Live Monitoring:', [
    'bdg peek                  Preview collected data (last 10 items)',
    'bdg peek --follow         Live updates every second',
    'bdg tail                  Continuous monitoring (like tail -f)',
    'bdg details network <id>  Full request/response details',
    'bdg details console <id>  Full console message details',
  ]);
}

/**
 * Builds the session management section.
 *
 * Shows commands for controlling the daemon and session lifecycle.
 *
 * @returns Formatted session management section
 */
export function buildSessionManagementSection(): string {
  return section('Session Management:', [
    'bdg status        Check session state',
    'bdg status --verbose     Include Chrome diagnostics',
    'bdg stop          End session',
    'bdg cleanup       Clean stale sessions',
  ]);
}

/**
 * Builds the CDP access section positioned as advanced fallback.
 *
 * Provides raw CDP protocol access for advanced use cases not covered
 * by high-level commands. Intentionally positioned after domain commands
 * to guide agents toward wrapper commands first.
 *
 * @returns Formatted CDP section
 */
export function buildCdpSection(): string {
  return section('Advanced: Raw CDP Access (53 domains, 300+ methods):', [
    'bdg cdp --list                      List all domains',
    'bdg cdp Network --list              List Network methods (39 methods)',
    'bdg cdp --search cookie             Search methods by keyword',
    'bdg cdp Runtime.evaluate --params \'{"expression":"document.title"}\'',
    '',
    'Use high-level commands above when possible for better efficiency.',
  ]);
}

/**
 * Builds the discovery section for AI agents.
 *
 * Points agents to machine-readable schemas and documentation resources.
 *
 * @returns Formatted discovery section
 */
export function buildDiscoverySection(): string {
  return section('Discovery (for AI agents):', [
    'bdg --help --json          Machine-readable schema (commands, options, exit codes)',
    '.claude/skills/bdg/        Claude skill with 15+ recipes & patterns',
  ]);
}
