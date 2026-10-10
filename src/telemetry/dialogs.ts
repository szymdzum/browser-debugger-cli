import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import type { DialogAnswer, DialogChoice, DialogInfo } from '@/ipc/protocol/domTypes.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { dialogNotAnsweredText } from '@/ui/messages/commands.js';

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
 * A `--prompt-text` given without `--dialog` accepts the prompt; an accepted
 * prompt without one gets its default value, as pressing OK does.
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
   * @param defaultPrompt - Default value of a prompt (`prompt(message, value)`)
   * @returns Reply to send
   */
  reply(type: string, defaultPrompt = ''): DialogReply {
    const action = this.actionChoice;
    if (type === 'beforeunload') return { accept: action?.dialog !== 'dismiss' };
    const promptAnswered = type === 'prompt' && action?.promptText !== undefined;
    const answer = action?.dialog ?? (promptAnswered ? 'accept' : this.sessionDefault);
    if (answer === 'dismiss') return { accept: false };
    return type === 'prompt'
      ? { accept: true, promptText: action?.promptText ?? defaultPrompt }
      : { accept: true };
  }
}

/**
 * Answer JavaScript dialogs as they open, so they never block the page.
 *
 * Each alert(), confirm(), prompt() and beforeunload dialog is answered right
 * away as {@link DialogAnswers} says (accepted, prompts with their default
 * value, by default)
 * and reported with its answer. The answer is chosen when the dialog opens:
 * one a page timer opens after an action returned gets the session default.
 *
 * @param cdp - CDP connection instance
 * @param answers - How to answer them
 * @param onDialog - Called for each dialog once Chrome took its answer (not
 *   for one it refused, e.g. closed meanwhile; that is logged instead)
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
    const reply = answers.reply(params.type, params.defaultPrompt);
    const answer = reply.accept ? 'accepted' : 'dismissed';
    const dialog: DialogInfo = {
      type: params.type,
      message: params.message,
      answer,
      ...(reply.promptText !== undefined && { promptText: reply.promptText }),
    };
    void cdp.send('Page.handleJavaScriptDialog', { ...reply }).then(
      () => {
        log.debug(`${answer} ${params.type} dialog: "${params.message}" from ${params.url}`);
        onDialog?.(dialog);
      },
      (error: Error) => {
        log.info(dialogNotAnsweredText(dialog, error.message));
      }
    );
  });

  return () => {
    registry.cleanup();
  };
}
