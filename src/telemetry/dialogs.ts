import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
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
  const typed = new TypedCDPConnection(cdp);

  await cdp.send('Page.enable');

  registry.registerTyped(typed, 'Page.javascriptDialogOpening', (params) => {
    log.debug(`Auto-dismissing ${params.type} dialog: "${params.message}" from ${params.url}`);

    void cdp
      .send('Page.handleJavaScriptDialog', {
        accept: true,
        promptText: params.type === 'prompt' ? '' : undefined,
      })
      .catch((error: Error) => {
        log.debug(`Failed to dismiss dialog: ${error.message}`);
      });
  });

  return () => {
    registry.cleanup();
  };
}
