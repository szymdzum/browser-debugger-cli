/**
 * How JavaScript dialogs are answered (#450): the built-in accept, the
 * session default, a per-action choice that wins while it is set, prompt
 * text, and beforeunload, which only an action's own dismiss cancels.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import type { DialogInfo } from '@/ipc/protocol/domTypes.js';
import { DialogAnswers, startDialogHandling } from '@/telemetry/dialogs.js';

/** CDP connection mock that records commands and emits events. */
class MockCDP {
  readonly sent: Array<{ method: string; params: unknown }> = [];
  private handlers = new Map<string, Array<(params: unknown) => void>>();

  /**
   * @param failing - CDP method whose calls are rejected
   */
  constructor(private readonly failing?: string) {}

  /**
   * Record a command.
   *
   * @param method - CDP method
   * @param params - Its parameters
   * @returns Empty result
   */
  send(method: string, params?: unknown): Promise<unknown> {
    this.sent.push({ method, params });
    if (method === this.failing) return Promise.reject(new Error('No dialog is showing'));
    return Promise.resolve({});
  }

  /**
   * Subscribe to an event.
   *
   * @param event - CDP event
   * @param handler - Handler
   * @returns Unsubscribe function
   */
  on(event: string, handler: (params: unknown) => void): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => list.splice(list.indexOf(handler), 1);
  }

  /**
   * Emit an event.
   *
   * @param event - CDP event
   * @param params - Event params
   */
  emit(event: string, params: unknown = {}): void {
    this.handlers.get(event)?.forEach((handler) => handler(params));
  }
}

/**
 * Let pending promise callbacks run.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

void describe('DialogAnswers', () => {
  void it('accepts every dialog by default, prompts with ""', () => {
    const answers = new DialogAnswers();
    assert.deepEqual(answers.reply('alert'), { accept: true });
    assert.deepEqual(answers.reply('confirm'), { accept: true });
    assert.deepEqual(answers.reply('prompt'), { accept: true, promptText: '' });
    assert.deepEqual(answers.reply('beforeunload'), { accept: true });
  });

  void it('dismisses with the session default, but still lets the page unload', () => {
    const answers = new DialogAnswers();
    answers.setSessionDefault('dismiss');
    assert.deepEqual(answers.reply('confirm'), { accept: false });
    assert.deepEqual(answers.reply('prompt'), { accept: false });
    assert.deepEqual(answers.reply('beforeunload'), { accept: true });
  });

  void it('lets an action choice win until it is cleared', () => {
    const answers = new DialogAnswers();
    answers.setSessionDefault('dismiss');
    answers.setActionChoice({ dialog: 'accept' });
    assert.deepEqual(answers.reply('confirm'), { accept: true });
    answers.setActionChoice(undefined);
    assert.deepEqual(answers.reply('confirm'), { accept: false });
  });

  void it('dismisses beforeunload only for an action that asked to dismiss', () => {
    const answers = new DialogAnswers();
    answers.setActionChoice({ dialog: 'dismiss' });
    assert.deepEqual(answers.reply('beforeunload'), { accept: false });
  });

  void it('answers prompts with the action prompt text, accepting them even over a dismiss default', () => {
    const answers = new DialogAnswers();
    answers.setSessionDefault('dismiss');
    answers.setActionChoice({ promptText: 'hello' });
    assert.deepEqual(answers.reply('prompt'), { accept: true, promptText: 'hello' });
    assert.deepEqual(answers.reply('confirm'), { accept: false }, 'prompt text is for prompts');
  });
});

void describe('DialogAnswers - prompt default value (#554)', () => {
  void it('gives an accepted prompt its default value, as OK does, when no text was chosen', () => {
    const answers = new DialogAnswers();
    assert.deepEqual(answers.reply('prompt', 'Ada'), { accept: true, promptText: 'Ada' });
    assert.deepEqual(answers.reply('prompt', ''), { accept: true, promptText: '' });
    answers.setActionChoice({ dialog: 'accept' });
    assert.deepEqual(answers.reply('prompt', 'Ada'), { accept: true, promptText: 'Ada' });
  });

  void it('prefers the chosen prompt text, and sends none for a dismissed prompt', () => {
    const answers = new DialogAnswers();
    answers.setActionChoice({ promptText: 'Bob' });
    assert.deepEqual(answers.reply('prompt', 'Ada'), { accept: true, promptText: 'Bob' });
    answers.setActionChoice({ dialog: 'dismiss' });
    assert.deepEqual(answers.reply('prompt', 'Ada'), { accept: false });
  });
});

void describe('startDialogHandling', () => {
  void it("answers an accepted prompt with the page's default value", async () => {
    const cdp = new MockCDP();
    const seen: DialogInfo[] = [];
    const stop = await startDialogHandling(
      cdp as unknown as CDPConnection,
      new DialogAnswers(),
      (dialog) => seen.push(dialog)
    );

    cdp.emit('Page.javascriptDialogOpening', {
      type: 'prompt',
      message: 'Name?',
      defaultPrompt: 'Ada',
      url: 'x',
    });
    await settle();
    stop();

    assert.deepEqual(seen, [
      { type: 'prompt', message: 'Name?', answer: 'accepted', promptText: 'Ada' },
    ]);
    assert.deepEqual(
      cdp.sent.filter((call) => call.method === 'Page.handleJavaScriptDialog').map((c) => c.params),
      [{ accept: true, promptText: 'Ada' }]
    );
  });

  void it('answers each dialog as chosen and reports the answer', async () => {
    const cdp = new MockCDP();
    const answers = new DialogAnswers();
    const seen: DialogInfo[] = [];
    const stop = await startDialogHandling(cdp as unknown as CDPConnection, answers, (dialog) =>
      seen.push(dialog)
    );

    cdp.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'Saved', url: 'x' });
    answers.setActionChoice({ dialog: 'dismiss' });
    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'Sure?', url: 'x' });
    answers.setActionChoice({ promptText: 'hello' });
    cdp.emit('Page.javascriptDialogOpening', { type: 'prompt', message: 'Name?', url: 'x' });
    await settle();
    stop();

    assert.deepEqual(seen, [
      { type: 'alert', message: 'Saved', answer: 'accepted' },
      { type: 'confirm', message: 'Sure?', answer: 'dismissed' },
      { type: 'prompt', message: 'Name?', answer: 'accepted', promptText: 'hello' },
    ]);
    assert.deepEqual(
      cdp.sent.filter((call) => call.method === 'Page.handleJavaScriptDialog').map((c) => c.params),
      [{ accept: true }, { accept: false }, { accept: true, promptText: 'hello' }]
    );
  });

  void it('records no answer for a dialog Chrome did not take the answer for', async () => {
    const cdp = new MockCDP('Page.handleJavaScriptDialog');
    const seen: DialogInfo[] = [];
    const stop = await startDialogHandling(
      cdp as unknown as CDPConnection,
      new DialogAnswers(),
      (dialog) => seen.push(dialog)
    );

    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'Sure?', url: 'x' });
    await settle();
    stop();

    assert.deepEqual(seen, []);
  });
});
