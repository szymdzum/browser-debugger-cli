/**
 * Shell quote damage detection utilities.
 *
 * Detects when shell quote handling has corrupted selectors or scripts,
 * providing actionable suggestions for recovery.
 */

export interface ShellDamageResult {
  damaged: boolean;
  type?: 'attribute-selector' | 'unquoted-argument';
  details?: string;
  suggestion?: string;
}

const ATTRIBUTE_SELECTOR_PATTERN = /\[[\w-]+=/.source;
const QUOTED_ATTRIBUTE_PATTERN = /\[[\w-]+=['"][^'"]*['"]\]/;
const UNQUOTED_ATTRIBUTE_PATTERN = /\[([\w-]+)=([\w-]+)\]/;
const BARE_ARGUMENT_PATTERN = /(\w+)\(\s*([a-zA-Z][\w-]*)\s*\)/;
const UNEXPECTED_IDENTIFIER_PATTERN = /Unexpected identifier ['"]?(\w+)['"]?/;

function noDamage(): ShellDamageResult {
  return { damaged: false };
}

function buildSelectorSuggestion(selector: string): string {
  return `Use the two-step pattern:\n  1. bdg dom query '${selector}'\n  2. bdg dom a11y describe 0`;
}

function checkUnquotedAttribute(selector: string): ShellDamageResult {
  if (QUOTED_ATTRIBUTE_PATTERN.test(selector)) {
    return noDamage();
  }

  const match = UNQUOTED_ATTRIBUTE_PATTERN.exec(selector);
  if (!match) {
    return noDamage();
  }

  const [, attr, value] = match;
  return {
    damaged: true,
    type: 'attribute-selector',
    details: `Received [${attr}=${value}] - quotes appear stripped`,
    suggestion: buildSelectorSuggestion(selector),
  };
}

function checkBareArgument(script: string): ShellDamageResult {
  const match = BARE_ARGUMENT_PATTERN.exec(script);
  if (!match) {
    return noDamage();
  }

  const [matchedPart, funcName, bareArg] = match;
  const fixedPart = `${funcName}("${bareArg}")`;
  const fixedScript = script.replace(matchedPart, fixedPart);

  return {
    damaged: true,
    type: 'unquoted-argument',
    details: `${funcName}(${bareArg}) - quotes stripped by shell`,
    suggestion: `Try: bdg dom eval '${fixedScript}'`,
  };
}

function checkUnexpectedIdentifier(script: string): ShellDamageResult {
  if (!UNEXPECTED_IDENTIFIER_PATTERN.test(script)) {
    return noDamage();
  }

  return {
    damaged: true,
    type: 'unquoted-argument',
    details: 'Unexpected identifier suggests quotes were stripped',
    suggestion: "Use single quotes around the script: bdg dom eval '...'",
  };
}

/**
 * Checks if a selector contains attribute syntax.
 *
 * @param selector - CSS selector to check
 * @returns True if selector contains attribute syntax
 */
export function hasAttributeSelector(selector: string): boolean {
  return new RegExp(ATTRIBUTE_SELECTOR_PATTERN).test(selector);
}

/**
 * Detects shell quote damage in CSS selectors.
 *
 * @param selector - The selector as received by the command
 * @returns Detection result with details and suggestions
 */
export function detectSelectorQuoteDamage(selector: string): ShellDamageResult {
  if (!hasAttributeSelector(selector)) {
    return noDamage();
  }

  return checkUnquotedAttribute(selector);
}

/**
 * Detects shell quote damage in JavaScript expressions.
 *
 * @param script - The script as received by the command
 * @returns Detection result with details and suggestions
 */
export function detectScriptQuoteDamage(script: string): ShellDamageResult {
  const bareArgResult = checkBareArgument(script);
  if (bareArgResult.damaged) {
    return bareArgResult;
  }

  return checkUnexpectedIdentifier(script);
}
