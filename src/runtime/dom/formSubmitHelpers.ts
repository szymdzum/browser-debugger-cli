/**
 * Form submission helpers with smart network waiting.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPTimeoutError } from '@/connection/errors.js';
import { trackInFlightRequests, type InFlightRequests } from '@/connection/inFlightRequests.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { submitNetworkBusyWarning, submitTimeoutError } from '@/errors/messages.js';
import type { SubmitResult } from '@/ipc/protocol/domTypes.js';
import { ELEMENT_IDENTITY_JS } from '@/runtime/dom/elementInfo.js';
import { throwIfInvalidSelector } from '@/runtime/dom/formFillHelpers/shared.js';
import { FIND_ELEMENTS_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { clickElement } from './formFillHelpers/index.js';

/**
 * Options for submitting a form.
 */
export interface SubmitOptions {
  /** Element index if selector matches multiple (0-based) */
  index?: number;
  /** Wait for page navigation after submit (default: false) */
  waitNavigation?: boolean;
  /** Wait for network idle after submit in milliseconds (default: 1000) */
  waitNetwork?: number;
  /** Maximum time to wait in milliseconds (default: 10000) */
  timeout?: number;
}

export type { SubmitResult } from '@/ipc/protocol/domTypes.js';

/**
 * Page script deciding how to submit the target.
 *
 * A `<form>` is submitted with `requestSubmit()` (what pressing a submit
 * button does); a submit button or other element inside a form is clicked
 * with real mouse events by the caller. Fails, like a browser would refuse,
 * when the form has invalid fields, and for elements that are neither a form
 * nor a button.
 */
const PREPARE_SUBMIT_SCRIPT = `
(function(selector, parts, index) {
  const matches = (${FIND_ELEMENTS_JS})(selector, parts);
  if (matches.length === 0) {
    return { action: 'fail', reason: 'not-found', error: 'Element not found: ' + selector };
  }
  const el = typeof index === 'number' ? matches[index] : matches[0];
  if (!el) {
    return {
      action: 'fail',
      reason: 'range',
      error: 'Index ' + index + ' out of range (found ' + matches.length + ' elements)'
    };
  }
  const isForm = el.tagName === 'FORM';
  const isButton = el.matches('button, input[type=submit], input[type=image], [role=button]');
  const isSubmitter = el.matches('button:not([type]), button[type=submit], input[type=submit], input[type=image]');
  const form = isForm ? el : el.form || el.closest('form');
  if (!isForm && !isButton) {
    return {
      action: 'fail',
      reason: 'not-submittable',
      error: 'Element is neither a form nor a submit button: <' + el.tagName.toLowerCase() + '>'
    };
  }
  const submitters = isForm
    ? Array.from(el.elements).filter((f) =>
        f.matches('button:not([type]), button[type=submit], input[type=submit], input[type=image]')
      )
    : [];
  if (submitters.length > 0 && submitters.every((f) => f.matches(':disabled'))) {
    // A user could not submit: Enter does nothing while the default button is disabled
    return { action: 'fail', reason: 'disabled', error: 'The form\\'s submit button is disabled' };
  }
  if ((isForm || isSubmitter) && form && !form.noValidate && !el.formNoValidate && !form.checkValidity()) {
    const invalid = Array.from(form.elements)
      .filter((f) => f.willValidate && !f.checkValidity())
      .map((f) => (f.name || f.id || f.tagName.toLowerCase()) + ': ' + f.validationMessage);
    return { action: 'fail', reason: 'invalid', error: 'Form has invalid fields - ' + invalid.join('; ') };
  }
  if (isForm) {
    // Like pressing Enter: the form's default button is the submitter, so its
    // name=value is sent too
    const submitter = submitters.find((f) => !f.matches(':disabled'));
    const element = (${ELEMENT_IDENTITY_JS})(submitter || el);
    if (submitter) el.requestSubmit(submitter);
    else el.requestSubmit();
    return { action: 'submitted', clicked: Boolean(submitter), element: element };
  }
  return { action: 'click' };
})`;

interface PrepareResult {
  action: 'submitted' | 'click' | 'fail';
  /** Whether a submit button took part (its value is sent) */
  clicked?: boolean;
  /** The submit button used, or the form without one */
  element?: string;
  reason?: 'not-found' | 'range' | 'not-submittable' | 'invalid' | 'disabled';
  error?: string;
}

const FAILURE_EXIT_CODES: Record<NonNullable<PrepareResult['reason']>, number> = {
  'not-found': EXIT_CODES.RESOURCE_NOT_FOUND,
  range: EXIT_CODES.INVALID_ARGUMENTS,
  'not-submittable': EXIT_CODES.INVALID_ARGUMENTS,
  invalid: EXIT_CODES.INVALID_ARGUMENTS,
  disabled: EXIT_CODES.INVALID_ARGUMENTS,
};

const FAILURE_SUGGESTIONS: Record<NonNullable<PrepareResult['reason']>, string> = {
  'not-found': 'Verify the selector matches a form or submit button',
  range: 'Use an --index within the number of matches',
  'not-submittable':
    'Target the <form> or its submit button, or use "bdg dom click" for other elements',
  invalid: 'Fill the listed fields first (see "bdg dom form" for their state)',
  disabled: 'Complete the steps that enable the button first (see "bdg dom form" for its state)',
};

/**
 * Watches navigation and network activity from before a submission is
 * triggered, so fast navigations are not missed.
 *
 * A navigation is a new document committed in the main frame
 * (`Page.frameNavigated`), whatever its URL: a POST that redirects back to
 * the form's own URL (a login error) navigates too.
 */
class SubmissionWatcher {
  private navigated = false;
  private documentRequest: string | undefined;
  private onChange: (() => void) | null = null;
  private readonly requests: InFlightRequests;
  private readonly disposers: Array<() => void> = [];

  /**
   * @param cdp - CDP connection
   */
  constructor(cdp: CDPConnection) {
    this.requests = trackInFlightRequests(cdp, () => this.onChange?.());
    this.disposers.push(this.requests.dispose);
    this.disposers.push(
      cdp.on<Protocol.Page.FrameNavigatedEvent>('Page.frameNavigated', (params, sessionId) => {
        if (sessionId !== undefined || params.frame.parentId !== undefined) return;
        this.navigated = true;
        this.onChange?.();
      }),
      cdp.on<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        (params, sessionId) => {
          if (sessionId !== undefined || params.type !== 'Document') return;
          this.documentRequest ??= `${params.request.method} ${params.request.url}`;
        }
      )
    );
  }

  /** Whether the main frame navigated since watching began. */
  get navigationOccurred(): boolean {
    return this.navigated;
  }

  /** The first page request sent since watching began (`POST https://…`), if any */
  get firstDocumentRequest(): string | undefined {
    return this.documentRequest;
  }

  /** Requests still in flight */
  get pendingRequests(): number {
    return this.requests.count;
  }

  /** Requests started since watching began. */
  get networkRequests(): number {
    return this.requests.started;
  }

  /**
   * Wait until the network is idle for `waitNetwork` ms and, if requested,
   * the main frame navigated. When a requested navigation happened but the
   * network was still busy at the timeout (a slow script or tracker on the
   * new page), the wait ends without an error: resolves to `'busy'`.
   *
   * @param options - Wait conditions
   * @returns `'idle'`, or `'busy'` when only the network wait timed out
   * @throws CDPTimeoutError after `timeout` ms
   */
  wait(options: {
    waitNavigation: boolean;
    waitNetwork: number;
    timeout: number;
  }): Promise<'idle' | 'busy'> {
    const { waitNavigation, waitNetwork, timeout } = options;
    return new Promise((resolve, reject) => {
      let idle: NodeJS.Timeout | null = null;
      const finish = (): void => {
        clearTimeout(deadline);
        if (idle) clearTimeout(idle);
        this.onChange = null;
      };
      const deadline = setTimeout(() => {
        finish();
        if (waitNavigation && this.navigated) resolve('busy');
        else
          reject(new CDPTimeoutError('Wait for completion timed out', new Error(`${timeout}ms`)));
      }, timeout);
      const check = (): void => {
        const networkIdle = waitNetwork === 0 || this.requests.count === 0;
        if (networkIdle && (!waitNavigation || this.navigated)) {
          finish();
          resolve('idle');
        }
      };
      const schedule = (): void => {
        if (idle) clearTimeout(idle);
        idle = null;
        if (waitNetwork === 0) check();
        else if (this.requests.count === 0) idle = setTimeout(check, waitNetwork);
      };
      this.onChange = schedule;
      schedule();
    });
  }

  /** Stop watching. */
  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
  }
}

/**
 * Submit the target: `requestSubmit()` for a form, a real click otherwise.
 *
 * @param cdp - CDP connection
 * @param selector - Selector (or bound-node placeholder)
 * @param index - Optional 0-based index among matches
 * @returns Failure result, or whether a submit button was used
 */
async function triggerSubmit(
  cdp: CDPConnection,
  selector: string,
  index: number | undefined
): Promise<{ failure: SubmitResult } | { clicked: boolean; element?: string | undefined }> {
  const response = (await cdp.send('Runtime.evaluate', {
    expression: `(${PREPARE_SUBMIT_SCRIPT})(${selectorArgsJS(selector)}, ${index ?? 'null'})`,
    returnByValue: true,
    userGesture: true,
  })) as {
    result?: { value?: PrepareResult };
    exceptionDetails?: Protocol.Runtime.ExceptionDetails;
  };
  if (response.exceptionDetails) throwIfInvalidSelector(response.exceptionDetails, selector);
  const prepared = response.result?.value;

  if (!prepared || prepared.action === 'fail') {
    const reason = prepared?.reason ?? 'not-found';
    const failure: SubmitResult = {
      success: false,
      error: prepared?.error ?? 'Could not submit',
      selector,
      clicked: false,
      exitCode: FAILURE_EXIT_CODES[reason],
      suggestion: FAILURE_SUGGESTIONS[reason],
    };
    return { failure };
  }
  if (prepared.action === 'submitted') {
    return { clicked: prepared.clicked === true, element: prepared.element };
  }

  const click = await clickElement(cdp, selector, index !== undefined ? { index } : {});
  if (click.success) return { clicked: true, element: click.element };
  const failure: SubmitResult = {
    success: false,
    error: click.error ?? 'Click failed',
    selector,
    clicked: false,
    ...(click.exitCode !== undefined && { exitCode: click.exitCode }),
    ...(click.suggestion !== undefined && { suggestion: click.suggestion }),
  };
  return { failure };
}

/**
 * Submit a form and wait for the result.
 *
 * @param cdp - CDP connection
 * @param selector - Form or submit button selector (or bound-node placeholder)
 * @param options - Submit options
 * @returns Submit result
 */
export async function submitForm(
  cdp: CDPConnection,
  selector: string,
  options: SubmitOptions = {}
): Promise<SubmitResult> {
  const { index, waitNavigation = false, waitNetwork = 1000, timeout = 10000 } = options;
  const startTime = Date.now();
  const watcher = new SubmissionWatcher(cdp);

  try {
    const triggered = await triggerSubmit(cdp, selector, index);
    if ('failure' in triggered) return triggered.failure;

    const outcome =
      waitNetwork > 0 || waitNavigation
        ? await watcher.wait({ waitNavigation, waitNetwork, timeout })
        : 'idle';
    return {
      success: true,
      selector,
      ...(triggered.element !== undefined && { element: triggered.element }),
      clicked: triggered.clicked,
      networkRequests: watcher.networkRequests,
      navigationOccurred: watcher.navigationOccurred,
      waitTimeMs: Date.now() - startTime,
      ...(outcome === 'busy' && {
        warning: submitNetworkBusyWarning(timeout, watcher.pendingRequests),
      }),
    };
  } catch (error) {
    if (!(error instanceof CDPTimeoutError)) throw error;
    const err = submitTimeoutError(timeout, waitNavigation, watcher.firstDocumentRequest);
    return {
      success: false,
      error: err.message,
      selector,
      clicked: true,
      navigationOccurred: watcher.navigationOccurred,
      waitTimeMs: Date.now() - startTime,
      exitCode: EXIT_CODES.CDP_TIMEOUT,
      suggestion: err.suggestion,
    };
  } finally {
    watcher.dispose();
  }
}
