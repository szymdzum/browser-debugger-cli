import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { CleanupFunction } from '@/types';
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('dialogs');

/**
 * Start auto-dismissing JavaScript dialogs to prevent collection blocking.
 *
 * Automatically accepts all alert(), confirm(), and prompt() dialogs that appear
 * during collection. Without this, dialogs would block the page and prevent
 * further telemetry collection.
 *
 * @param cdp - CDP connection instance
 * @returns Cleanup function to remove event handlers
 *
 * @remarks
 * - All dialogs are automatically accepted (user cannot interact)
 * - Prompt dialogs receive empty string as input
 * - beforeunload dialogs are accepted to allow navigation
 * - Dialog occurrences are logged in debug mode for visibility
 *
 * @example
 * ```typescript
 * const cleanup = await startDialogHandling(cdp);
 * // ... page may show alert("Hello") - automatically dismissed
 * cleanup(); // Stop handling dialogs
 * ```
 */
export async function startDialogHandling(cdp: CDPConnection): Promise<CleanupFunction> {
  const registry = new CDPHandlerRegistry();

  // Enable Page domain to receive dialog events
  await cdp.send('Page.enable');

  // Listen for JavaScript dialog opening events
  registry.register<Protocol.Page.JavascriptDialogOpeningEvent>(
    cdp,
    'Page.javascriptDialogOpening',
    (params: Protocol.Page.JavascriptDialogOpeningEvent) => {
      log.debug(`Auto-dismissing ${params.type} dialog: "${params.message}" from ${params.url}`);

      // Auto-accept all dialogs to prevent blocking
      // For prompt dialogs, use empty string as input
      // Fire and forget - we don't await the response but handle errors
      void cdp
        .send('Page.handleJavaScriptDialog', {
          accept: true,
          promptText: params.type === 'prompt' ? '' : undefined,
        })
        .catch((error: Error) => {
          log.debug(`Failed to dismiss dialog: ${error.message}`);
        });
    }
  );

  // Return cleanup function
  return () => {
    registry.cleanup(cdp);
  };
}
