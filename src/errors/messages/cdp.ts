/**
 * CDP error messages.
 */

import type { MissingMethodCause } from '@/cdp/methodTarget.js';
import { formatMiB, joinLines } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { type ErrorWithSuggestion } from './shared.js';

/**
 * `bdg cdp --search` with an empty or blank query (which would match every method).
 */
export function emptyCdpSearchError(): ErrorWithSuggestion {
  return {
    message: 'Empty search query',
    suggestion: 'Search for a keyword, e.g. bdg cdp --search cookie; list domains: bdg cdp --list',
  };
}

/**
 * Chrome rejected a CDP method or its parameters.
 *
 * @param detail - Chrome's error message
 */
export function cdpRequestRejectedError(detail: string): ErrorWithSuggestion {
  return {
    message: detail,
    suggestion: 'Check the method and its parameters: bdg cdp <Method> --describe',
  };
}

/** CDP error messages that name something that does not exist (a node, target, frame…) */
const CDP_NOT_FOUND_PATTERN =
  /could not find|cannot find|not found|no \w+ (with|for) (the )?given|does not exist|no such/i;

/**
 * `bdg cdp` when Chrome rejected the call: a missing node, target or
 * frame, or wrong parameters.
 *
 * @param method - CDP method
 * @param message - Chrome's error
 * @returns Message, suggestion, and whether something named was not found
 */
export function cdpCallError(
  method: string,
  message: string
): ErrorWithSuggestion & { notFound: boolean } {
  if (CDP_NOT_FOUND_PATTERN.test(message)) {
    const ids = /node/i.test(message)
      ? 'Node ids come from DOM.getDocument (the root) or DOM.querySelector, and a new DOM.getDocument or a navigation replaces them; '
      : '';
    return {
      message: `${method}: ${message}`,
      suggestion: `${ids}check the ids with ${sessionCommand(`bdg cdp ${method} --describe`)}`,
      notFound: true,
    };
  }
  return {
    message: `${method}: ${message}`,
    suggestion: `See the parameters with ${sessionCommand(`bdg cdp ${method} --describe`)}`,
    notFound: false,
  };
}

/**
 * `bdg cdp` when Chrome answered -32601: it has no such method (for the
 * page target). What it says depends on why, as far as the bundled protocol
 * tells: an unknown domain, a redirect to a method the protocol lacks, a
 * Chrome older than the protocol, or a method only Chrome could know (typed
 * in one case, it gets a reminder that such names are case-sensitive).
 *
 * @param method - CDP method
 * @param chromeMessage - Chrome's error, e.g. "'Foo.bar' wasn't found"
 * @param cause - Why Chrome may lack it
 * @returns Message and suggestion
 */
export function cdpMethodNotImplementedError(
  method: string,
  chromeMessage: string,
  cause: MissingMethodCause
): ErrorWithSuggestion {
  const search = sessionCommand('bdg cdp --search <keyword>');
  switch (cause.kind) {
    case 'unknownDomain':
      return {
        message: `Unknown CDP domain ${cause.domain}: it is not in bdg's bundled protocol, and this Chrome doesn't implement ${method} (${chromeMessage})`,
        suggestion: joinLines(
          cause.similar.length > 0 ? `Did you mean: ${cause.similar.join(', ')}?` : undefined,
          `List the domains: ${sessionCommand('bdg cdp --list')}`
        ),
      };
    case 'deadRedirect':
      return {
        message: `This Chrome doesn't implement ${method}: the protocol redirects it to ${cause.target}, which does not exist (${chromeMessage})`,
        suggestion:
          cause.similar.length > 0
            ? `Did you mean: ${cause.similar.join(', ')}? See: ${sessionCommand(`bdg cdp ${cause.similar[0]} --describe`)}`
            : `Find another method: ${search}`,
      };
    case 'older':
      return {
        message: `This Chrome doesn't implement ${method} (${chromeMessage})`,
        suggestion: `bdg's bundled protocol has it, but this Chrome is older (or ${method} is not available on a page). Use a newer Chrome, or find another method: ${search}`,
      };
    case 'unlisted':
      return {
        message: `This Chrome doesn't implement ${method} (${chromeMessage})`,
        suggestion: cause.oneCase
          ? `CDP method names are case-sensitive for methods bdg doesn't know: ${method} was sent as typed. Type it in lowerCamelCase as Chrome names it (getCookies, not getcookies), or find a method: ${search}`
          : `Check the spelling (Chrome's method names are case-sensitive), or find a method: ${search}`,
      };
  }
}

/**
 * `bdg cdp <Domain.Type>` without `--describe`: a type cannot be called.
 *
 * @param name - Full type name, e.g. Network.CookieSameSite
 * @returns Message and suggestion
 */
export function cdpTypeNotMethodError(name: string): ErrorWithSuggestion {
  return {
    message: `${name} is a protocol type, not a method`,
    suggestion: `Use: bdg cdp ${name} --describe (to see its values or properties)`,
  };
}

/**
 * `bdg cdp <name>` for a close typo of bundled methods, or a name that is
 * not `Domain.method`.
 *
 * @param input - Name as typed
 * @param similar - Methods to suggest
 * @param listHint - First suggestion line (how to find methods)
 * @returns Message and suggestion
 */
export function cdpMethodNotFoundError(
  input: string,
  similar: string[],
  listHint: string
): ErrorWithSuggestion {
  const didYouMean =
    similar.length > 0 ? ['', 'Did you mean:', ...similar.map((name) => `  - ${name}`)] : [];
  return {
    message: `Method '${input}' not found`,
    suggestion: [listHint, ...didYouMean].join('\n'),
  };
}

/**
 * `bdg cdp <name>` for a close typo of bundled methods or domains: did you
 * mean, or how to send it as typed (a method newer than the bundled protocol).
 *
 * @param input - Name as typed
 * @param similar - Methods to suggest
 * @param listHint - First suggestion line (how to find methods)
 * @returns Message and suggestion
 */
export function cdpMethodTypoError(
  input: string,
  similar: string[],
  listHint: string
): ErrorWithSuggestion {
  const err = cdpMethodNotFoundError(input, similar, listHint);
  return {
    message: err.message,
    suggestion: `${err.suggestion}\n\nTo send it as typed (a method newer than bdg's protocol): ${sessionCommand(`bdg cdp ${input} --send-anyway`)}`,
  };
}

/**
 * `bdg cdp <Domain.method> --describe` for a method the bundled protocol lacks.
 *
 * @param method - Method as typed
 * @param protocolVersion - Bundled devtools-protocol version
 * @returns Message and suggestion
 */
export function cdpMethodNotInBundledProtocolError(
  method: string,
  protocolVersion: string
): ErrorWithSuggestion {
  return {
    message: `Method '${method}' is not in the bundled protocol (devtools-protocol ${protocolVersion})`,
    suggestion: `bdg cdp ${method} sends it to Chrome as is, which may still have it. Methods bdg knows: bdg cdp --search <keyword>`,
  };
}

/** How to get a smaller reply from `bdg cdp` */
const SMALLER_CDP_REPLY_SUGGESTION =
  "Return less: slice the value in the expression (a string: 'x'.slice(0, 10000000)), or pass returnByValue:false and read a smaller property of the object";

/** How to get a smaller reply from any other command */
const SMALLER_REPLY_SUGGESTION =
  'Ask for less: narrow the command with a filter, fewer items or a smaller range';

/**
 * How to ask for a smaller reply.
 *
 * @param request - Type of the request the reply answers
 * @returns The suggestion for a `bdg cdp` call or for any other command
 */
function smallerReplySuggestion(request: string): string {
  return request.startsWith('cdp_call') ? SMALLER_CDP_REPLY_SUGGESTION : SMALLER_REPLY_SUGGESTION;
}

/**
 * A reply of the daemon over the longest line the client reads.
 *
 * @param size - Characters of the reply, or read so far
 * @param cap - The longest line
 * @param request - Type of the request it answers
 * @param exact - Whether `size` is the whole reply (false: reading stopped at it)
 * @returns Error naming the size and the limit, and how to ask for less
 */
export function replyTooLargeError(
  size: number,
  cap: number,
  request: string,
  exact = true
): ErrorWithSuggestion {
  const limit = formatMiB(cap, 0);
  return {
    message: exact
      ? `The reply is ${formatMiB(size)}, over the ${limit} limit`
      : `The reply is over the ${limit} limit (reading stopped at ${formatMiB(size)})`,
    suggestion: smallerReplySuggestion(request),
  };
}

/**
 * A `bdg cdp` call whose reply Chrome could not send (about 256 MiB and more).
 *
 * @param cap - The longest reply
 * @returns Error naming the limit and how to ask for less
 */
export function chromeReplyLostError(cap: number): ErrorWithSuggestion {
  return {
    message: `Chrome could not send the reply: it is over Chrome's message limit (about ${formatMiB(cap, 0)} of UTF-8 bytes; non-ASCII text reaches it with fewer characters)`,
    suggestion: SMALLER_CDP_REPLY_SUGGESTION,
  };
}
