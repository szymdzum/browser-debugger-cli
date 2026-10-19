/**
 * Failed loads read from the page and followed as they happen (#860): the
 * error page's code, the certificate interstitial (no failure), the main
 * frame's document requests, and the start's check after its navigation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import type { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { navigateToTarget } from '@/daemon/session/cdpSetup.js';
import { CommandError } from '@/errors/index.js';
import {
  failedLoadError,
  parseErrorCode,
  readFailedLoad,
  trackFailedLoad,
  watchMainDocuments,
} from '@/runtime/page/failedLoad.js';
import type { FailedLoad } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** A page connection that answers some methods and lets the test emit events */
interface FakePage {
  cdp: CDPConnection;
  emit: (event: string, params: unknown) => void;
}

/**
 * A fake page connection.
 *
 * @param answers - Answer per method (a function gets the params); other methods reject
 * @returns The connection and its event emitter
 */
function fakePage(answers: Record<string, unknown>): FakePage {
  const handlers = new Map<string, Array<(params: unknown) => void>>();
  const cdp = {
    send: (method: string, params?: unknown) => {
      if (!(method in answers)) return Promise.reject(new Error(`${method} not faked`));
      const answer = answers[method];
      return Promise.resolve(
        typeof answer === 'function' ? (answer as (p: unknown) => unknown)(params) : answer
      );
    },
    on: (event: string, handler: (params: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () =>
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler)
        );
    },
  } as unknown as CDPConnection;
  const emit = (event: string, params: unknown): void =>
    (handlers.get(event) ?? []).forEach((handler) => handler(params));
  return { cdp, emit };
}

/**
 * Answers of a main frame and the error code its page shows.
 *
 * @param frame - Main frame fields
 * @param errorCode - Text of the page's `.error-code`
 * @returns Answers for {@link fakePage}
 */
function frameAnswers(frame: Record<string, unknown>, errorCode = ''): Record<string, unknown> {
  return {
    'Page.getFrameTree': { frameTree: { frame: { id: 'main', loaderId: 'L0', ...frame } } },
    'Runtime.evaluate': { result: { value: errorCode } },
  };
}

void describe('parseErrorCode', () => {
  const cases: Array<[unknown, string]> = [
    ['ERR_CONNECTION_REFUSED', 'net::ERR_CONNECTION_REFUSED'],
    ['NET::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_AUTHORITY_INVALID'],
    ['  net::err_ssl_protocol_error ', 'net::ERR_SSL_PROTOCOL_ERROR'],
    ['This site can’t be reached ERR_CONNECTION_REFUSED', 'net::ERR_FAILED'],
    ['garbage', 'net::ERR_FAILED'],
    ['', 'net::ERR_FAILED'],
    [42, 'net::ERR_FAILED'],
  ];
  for (const [value, expected] of cases) {
    void it(`${JSON.stringify(value)} → ${expected}`, () => {
      assert.equal(parseErrorCode(value), expected);
    });
  }
});

void describe('readFailedLoad', () => {
  void it('a frame showing a document is no failure', async () => {
    const { cdp } = fakePage(frameAnswers({ url: 'http://app.test/' }));
    assert.equal(await readFailedLoad(cdp), undefined);
  });

  void it("Chrome's error page is the failed load it names", async () => {
    const frame = { url: 'chrome-error://chromewebdata/', unreachableUrl: 'http://app.test/' };
    const { cdp } = fakePage(frameAnswers(frame, 'ERR_CONNECTION_REFUSED'));
    assert.deepEqual(await readFailedLoad(cdp), {
      url: 'http://app.test/',
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });
  });

  void it('the certificate interstitial is a certificate warning, not a failure', async () => {
    const frame = { url: 'chrome-error://chromewebdata/', unreachableUrl: 'https://self.test/' };
    const { cdp } = fakePage(frameAnswers(frame, 'NET::ERR_CERT_AUTHORITY_INVALID'));
    assert.deepEqual(await readFailedLoad(cdp), {
      url: 'https://self.test/',
      errorText: 'net::ERR_CERT_AUTHORITY_INVALID',
      certificate: true,
    });
  });

  void it('an error page that names no code is a failure (net::ERR_FAILED)', async () => {
    const frame = { url: 'chrome-error://chromewebdata/', unreachableUrl: 'http://app.test/' };
    const { cdp } = fakePage(frameAnswers(frame, 'something else'));
    assert.equal((await readFailedLoad(cdp))?.errorText, 'net::ERR_FAILED');
  });
});

void describe('watchMainDocuments', () => {
  void it('reports failed main-frame documents only', () => {
    const { cdp, emit } = fakePage({});
    const failed: string[] = [];
    const watch = watchMainDocuments(cdp, 'main', (id, load) =>
      failed.push(`${id} ${load.errorText}`)
    );
    const request = (requestId: string, frameId: string, type = 'Document'): void =>
      emit('Network.requestWillBeSent', {
        requestId,
        frameId,
        type,
        request: { url: `http://a.test/${requestId}` },
      });
    request('doc', 'main');
    request('frame', 'child');
    request('script', 'main', 'Script');
    request('download', 'main');
    for (const requestId of ['doc', 'frame', 'script']) {
      emit('Network.loadingFailed', { requestId, errorText: 'net::ERR_CONNECTION_REFUSED' });
    }
    emit('Network.loadingFailed', { requestId: 'download', errorText: 'net::ERR_ABORTED' });
    watch.stop();
    assert.deepEqual(failed, ['doc net::ERR_CONNECTION_REFUSED']);
  });
});

void describe('a failure after a redirect', () => {
  void it('names where the redirect led', () => {
    const { cdp, emit } = fakePage({});
    const failed: FailedLoad[] = [];
    const watch = watchMainDocuments(cdp, 'main', (_id, load) => failed.push(load));
    const hop = (url: string): void =>
      emit('Network.requestWillBeSent', {
        requestId: 'r',
        frameId: 'main',
        type: 'Document',
        request: { url },
      });
    hop('http://a.test/');
    hop('http://127.0.0.1:1/');
    emit('Network.loadingFailed', { requestId: 'r', errorText: 'net::ERR_UNSAFE_PORT' });
    watch.stop();
    assert.deepEqual(failed, [
      {
        url: 'http://a.test/',
        errorText: 'net::ERR_UNSAFE_PORT',
        redirectedTo: 'http://127.0.0.1:1/',
      },
    ]);
    assert.equal(
      failedLoadError(failed[0] as FailedLoad).message,
      'Could not load http://a.test/ (redirected to http://127.0.0.1:1/): net::ERR_UNSAFE_PORT'
    );
  });
});

void describe('trackFailedLoad', () => {
  void it('reports the failure the page shows, a failed document, and clears on a document that answers', async () => {
    const frame = { url: 'chrome-error://chromewebdata/', unreachableUrl: 'http://old.test/' };
    const { cdp, emit } = fakePage(frameAnswers(frame, 'ERR_NAME_NOT_RESOLVED'));
    const seen: Array<FailedLoad | undefined> = [];
    const stop = await trackFailedLoad(cdp, (failed) => seen.push(failed));
    const document = { type: 'Document', frameId: 'main', request: { url: 'http://new.test/' } };
    emit('Network.requestWillBeSent', { ...document, requestId: 'a' });
    emit('Network.loadingFailed', { requestId: 'a', errorText: 'net::ERR_TOO_MANY_REDIRECTS' });
    emit('Network.requestWillBeSent', { ...document, requestId: 'b' });
    emit('Network.responseReceived', {
      requestId: 'b',
      type: 'Document',
      response: { status: 200 },
    });
    stop();
    assert.deepEqual(seen, [
      { url: 'http://old.test/', errorText: 'net::ERR_NAME_NOT_RESOLVED' },
      { url: 'http://new.test/', errorText: 'net::ERR_TOO_MANY_REDIRECTS' },
      undefined,
    ]);
  });
});

void describe('navigateToTarget after the navigation', () => {
  const config = { url: 'http://app.test/', port: 9222 };
  const log = createLogger('session');

  void it('a failure the tab showed before is not the navigation’s (a 204 keeps the page)', async () => {
    const store = {
      failedLoad: { url: 'http://old.test/', errorText: 'net::ERR_CONNECTION_REFUSED' },
    };
    const { cdp } = fakePage({
      'Page.navigate': { frameId: 'main', loaderId: 'L1', errorText: 'net::ERR_ABORTED' },
    });
    assert.equal(
      await navigateToTarget(cdp, config, store as unknown as TelemetryStore, null, log),
      'L1'
    );
  });

  void it('the certificate warning is a success, recorded for the start output', async () => {
    const store: { failedLoad?: FailedLoad } = {};
    const frame = { url: 'chrome-error://chromewebdata/', unreachableUrl: 'https://self.test/' };
    const { cdp } = fakePage({
      ...frameAnswers(frame, 'NET::ERR_CERT_DATE_INVALID'),
      'Page.navigate': { frameId: 'main', loaderId: 'L1', errorText: 'net::ERR_CERT_DATE_INVALID' },
    });
    await navigateToTarget(cdp, config, store as unknown as TelemetryStore, null, log);
    assert.equal(store.failedLoad?.certificate, true);
  });

  void it('a document of the navigation that fails after it committed exits 80', async () => {
    const store: { failedLoad?: FailedLoad } = {};
    const { cdp } = fakePage({
      'Page.navigate': () => {
        store.failedLoad = {
          url: 'http://app.test/',
          errorText: 'net::ERR_CONTENT_LENGTH_MISMATCH',
        };
        return { frameId: 'main', loaderId: 'L1' };
      },
    });
    await assert.rejects(
      navigateToTarget(cdp, config, store as unknown as TelemetryStore, null, log),
      (error: unknown) =>
        error instanceof CommandError &&
        error.exitCode === EXIT_CODES.INVALID_URL &&
        /ERR_CONTENT_LENGTH_MISMATCH/.test(error.message)
    );
  });
});
