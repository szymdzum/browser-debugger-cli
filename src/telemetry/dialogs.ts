import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import type { DialogAnswer, DialogChoice, DialogInfo } from '@/ipc/protocol/domTypes.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('dialogs');

/** What bdg sends back to a dialog (`Page.handleJavaScriptDialog`) */
export interface DialogReply {
  accept: boolean;
  /** Text a prompt() gets (accepted prompts only) */
  promptText?: string;
}

/**
 * How the session answers JavaScript dialogs: the session default
 * (`bdg <url> --dialog`, built-in `accept`), overridden by the choice of the
 * action that is running (`--dialog`, `--prompt-text` on a DOM action).
 *
 * A beforeunload dialog is accepted, so navigation is never blocked, unless
 * the running action asked to dismiss dialogs: the session default does not
 * apply to it, or every navigation away from the page would be cancelled.
 * A `--prompt-text` given without `--dialog` accepts the prompt.
 */
export class DialogAnswers {
  private sessionDefault: DialogAnswer = 'accept';
  private actionChoice: DialogChoice | undefined;

  /**
   * Set the session default (`bdg <url> --dialog`).
   *
   * @param answer - Answer for dialogs no action chose one for (default: accept)
   */
  setSessionDefault(answer: DialogAnswer | undefined): void {
    this.sessionDefault = answer ?? 'accept';
  }

  /**
   * Set the choice of the running action, or clear it once it finished.
   *
   * @param choice - The action's `--dialog` / `--prompt-text`, or undefined
   */
  setActionChoice(choice: DialogChoice | undefined): void {
    this.actionChoice = choice;
  }

  /**
   * How to answer a dialog that opens now.
   *
   * @param type - Dialog type: alert, confirm, prompt or beforeunload
   * @returns Reply to send
   */
  reply(type: string): DialogReply {
    const action = this.actionChoice;
    if (type === 'beforeunload') return { accept: action?.dialog !== 'dismiss' };
    const promptAnswered = type === 'prompt' && action?.promptText !== undefined;
    const answer = action?.dialog ?? (promptAnswered ? 'accept' : this.sessionDefault);
    if (answer === 'dismiss') return { accept: false };
    return type === 'prompt'
      ? { accept: true, promptText: action?.promptText ?? '' }
      : { accept: true };
  }
}

/**
 * Answer JavaScript dialogs as they open, so they never block the page.
 *
 * Each alert(), confirm(), prompt() and beforeunload dialog is answered right
 * away as {@link DialogAnswers} says (accepted, prompts with "", by default)
 * and reported with its answer. The answer is chosen when the dialog opens:
 * one a page timer opens after an action returned gets the session default.
 *
 * @param cdp - CDP connection instance
 * @param answers - How to answer them
 * @param onDialog - Called for each dialog, with its answer
 * @returns Cleanup function to remove event handlers
 */
export async function startDialogHandling(
  cdp: CDPConnection,
  answers: DialogAnswers,
  onDialog?: (dialog: DialogInfo) => void
): Promise<CleanupFunction> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);

  await cdp.send('Page.enable');

  registry.registerTyped(typed, 'Page.javascriptDialogOpening', (params) => {
    const reply = answers.reply(params.type);
    const answer = reply.accept ? 'accepted' : 'dismissed';
    log.debug(`${answer} ${params.type} dialog: "${params.message}" from ${params.url}`);
    onDialog?.({
      type: params.type,
      message: params.message,
      answer,
      ...(reply.promptText !== undefined && { promptText: reply.promptText }),
    });

    void cdp.send('Page.handleJavaScriptDialog', { ...reply }).catch((error: Error) => {
      log.debug(`Failed to answer dialog: ${error.message}`);
    });
  });

  return () => {
    registry.cleanup();
  };
}
