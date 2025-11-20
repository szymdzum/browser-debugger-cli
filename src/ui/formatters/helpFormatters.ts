/**
 * Help message formatting helpers for bare command and usage instructions.
 *
 * Provides well-structured sections for agent discovery, task examples,
 * and URL format guidance.
 */

import { section } from '@/ui/formatting.js';

/**
 * Builds the agent discovery help section.
 *
 * Prominently displays machine-readable schema and CDP discovery commands
 * to guide agents toward efficient tool usage patterns.
 *
 * @returns Formatted agent discovery section
 */
export function buildAgentDiscoveryHelp(): string {
  return section('For AI Agents:', [
    'bdg --help --json          Machine-readable command schema',
    'bdg cdp --list             List all 53 CDP domains',
    'bdg cdp --search <term>    Search 300+ CDP methods',
    '.claude/skills/bdg/        15+ recipes & workflow patterns',
  ]);
}

/**
 * Builds the common task examples section.
 *
 * Shows complete workflow examples for typical automation tasks,
 * demonstrating session start followed by specific commands.
 *
 * @returns Formatted task examples section
 */
export function buildCommonTaskExamples(): string {
  return section('Common Task Workflows:', [
    'Screenshot:',
    '  bdg https://example.com',
    '  bdg dom screenshot output.png',
    '',
    'Scrape content:',
    '  bdg https://news.site',
    '  bdg dom query "article h2" --json',
    '',
    'Fill form:',
    '  bdg https://example.com/login',
    '  bdg dom fill "#email" "test@example.com"',
    '  bdg dom click "button[type=submit]"',
    '',
    'Export network data:',
    '  bdg https://api.example.com',
    '  bdg network har output.har',
  ]);
}

/**
 * Builds the URL format examples section.
 *
 * Shows supported URL formats for starting sessions.
 *
 * @returns Formatted URL examples section
 */
export function buildUrlExamples(): string {
  return section('URL Formats:', [
    'bdg example.com              (http:// added automatically)',
    'bdg localhost:3000           (local development server)',
    'bdg https://github.com       (explicit protocol)',
  ]);
}

/**
 * Builds the session management reminder section.
 *
 * Shows commands for managing active sessions and getting help.
 *
 * @returns Formatted session management section
 */
export function buildSessionManagementReminder(): string {
  return section('Existing Session:', [
    'bdg status      Check session state',
    'bdg stop        End session',
    'bdg --help      Show all commands',
  ]);
}
