/**
 * Shell quote damage detection utilities.
 *
 * Detects when shell quote handling has corrupted selectors or scripts,
 * providing actionable suggestions for recovery.
 */

import { sessionCommand } from '@/ui/messages/sessionCommand.js';

export interface ShellDamageResult {
  damaged: boolean;
  type?: 'attribute-selector' | 'unquoted-argument';
  details?: string;
  suggestion?: string;
}

const ATTRIBUTE_SELECTOR_PATTERN = /\[[\w-]+=/.source;
const QUOTED_ATTRIBUTE_PATTERN = /\[[\w-]+=['"][^'"]*['"]\]/;
const UNQUOTED_ATTRIBUTE_PATTERN = /\[([\w-]+)=([\w-]+)\]/;

/** DOM methods whose one argument is a string (a selector, id, name or class) */
const STRING_ARGUMENT_METHODS = new Set([
  'querySelector',
  'querySelectorAll',
  'getElementById',
  'getElementsByClassName',
  'getElementsByTagName',
  'getElementsByName',
  'closest',
  'matches',
  'getAttribute',
  'hasAttribute',
  'removeAttribute',
  'toggleAttribute',
  'createElement',
  'add',
  'remove',
  'toggle',
]);

/** A call with one argument and no quotes, parentheses or commas in it */
const UNQUOTED_CALL_PATTERN = /([\w$]+)\(\s*([^()'"`,]+?)\s*\)/g;

/** `x is not defined`: the shell may have turned `"x"` into `x` */
const NOT_DEFINED_PATTERN = /^ReferenceError: ([\w$]+) is not defined/;

/**
 * The syntax errors V8 raises for `fn(div p)`: the shell may have turned
 * `"div p"` into `div p`
 */
const SEVERAL_WORDS_PATTERN =
  /^SyntaxError: (?:missing \) after argument list|Unexpected identifier '([\w$]+)')/;

/** Words that may start a valid expression of several words */
const EXPRESSION_KEYWORDS = /^(?:new|typeof|void|delete|await|yield)\b/;

function noDamage(): ShellDamageResult {
  return { damaged: false };
}

function buildSelectorSuggestion(selector: string): string {
  return `Use the two-step pattern:\n  1. ${sessionCommand(`bdg dom query '${selector}'`)}\n  2. ${sessionCommand('bdg dom a11y describe 0')}`;
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

/**
 * Whether the script declares a name itself (then it is a variable, not a
 * string that lost its quotes).
 *
 * @param script - The script
 * @param name - Identifier
 * @returns True for a `const`/`let`/`var`/`function`/`class` declaration of it
 */
function declares(script: string, name: string): boolean {
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp(`\\b(?:const|let|var|function|class)\\s+${escaped}\\b`).test(script);
}

/** An error stripped quotes can cause, and the identifier it names (if it does) */
type QuoteError = { kind: 'undefined'; name: string } | { kind: 'syntax'; name?: string };

/**
 * Whether text starts with an identifier (and not with a longer one).
 *
 * @param text - Text
 * @param name - Identifier
 * @returns True when `text` is `name` or `name` followed by a non-identifier character
 */
function startsWithName(text: string, name: string): boolean {
  return text.startsWith(name) && !/^[\w$]/.test(text.slice(name.length));
}

/**
 * Whether an unquoted argument is what the error complains about: for
 * `ReferenceError` the argument starts with the undefined name (`input`,
 * `my-id`, `button.primary`); for `SyntaxError` it is several bare words
 * (`div p`), the unexpected one (when named) among the later ones.
 *
 * @param argument - Unquoted argument
 * @param error - What the error says
 * @returns True when quotes stripped from it explain the error
 */
function explainsError(argument: string, error: QuoteError): boolean {
  if (error.kind === 'undefined') return startsWithName(argument, error.name);
  const [, ...laterWords] = argument.split(/\s+/);
  return (
    !EXPRESSION_KEYWORDS.test(argument) &&
    laterWords.length > 0 &&
    (error.name === undefined || laterWords.some((word) => startsWithName(word, error.name ?? '')))
  );
}

/**
 * Read the identifier an error is about, when the error is one stripped
 * quotes cause.
 *
 * @param errorMessage - The JavaScript error
 * @returns The identifier and kind of error, or undefined for other errors
 */
function quoteRelatedError(errorMessage: string): QuoteError | undefined {
  const notDefined = NOT_DEFINED_PATTERN.exec(errorMessage);
  if (notDefined?.[1]) return { kind: 'undefined', name: notDefined[1] };
  const syntax = SEVERAL_WORDS_PATTERN.exec(errorMessage);
  if (!syntax) return undefined;
  return syntax[1] ? { kind: 'syntax', name: syntax[1] } : { kind: 'syntax' };
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
 * Detects shell quote damage in JavaScript expressions. Conservative: only an
 * error stripped quotes cause (`x is not defined`,
 * `missing ) after argument list`, `Unexpected identifier`) counts, about an
 * argument of a DOM method that takes a string (`querySelector(input)`),
 * which the script does not declare itself.
 *
 * @param script - The script as received by the command
 * @param errorMessage - The error the script raised
 * @returns Detection result with details and suggestions
 */
export function detectScriptQuoteDamage(script: string, errorMessage: string): ShellDamageResult {
  const error = quoteRelatedError(errorMessage);
  if (!error || (error.name && declares(script, error.name))) return noDamage();
  for (const [call, method = '', argument = ''] of script.matchAll(UNQUOTED_CALL_PATTERN)) {
    if (!STRING_ARGUMENT_METHODS.has(method) || !explainsError(argument, error)) continue;
    const fixedScript = script.replace(call, `${method}("${argument}")`);
    return {
      damaged: true,
      type: 'unquoted-argument',
      details: `${method}(${argument}) - quotes stripped by shell`,
      suggestion: `Try: ${sessionCommand(`bdg dom eval '${fixedScript}'`)}`,
    };
  }
  return noDamage();
}
