/**
 * Chrome Issues (`Audits.issueAdded`): only the allowlisted kinds are kept,
 * duplicates once, and only those of the page currently loaded.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import {
  MAX_ISSUE_NODES,
  MAX_ISSUE_SEEN_REPORTS,
  MAX_ISSUE_TEXT_LENGTH,
  MAX_PAGE_ISSUES,
} from '@/constants.js';
import { PageIssueLog, startIssueCollection, toPageIssue } from '@/telemetry/issues.js';

type InspectorIssue = Protocol.Audits.InspectorIssue;

/** CDP connection mock that records commands, answers DOM.describeNode and emits events. */
class MockCDP {
  readonly sent: string[] = [];
  private handlers = new Map<string, Array<(params: unknown, sessionId?: string) => void>>();

  /**
   * Record a command; DOM.describeNode answers with a label.
   *
   * @param method - CDP method
   * @returns Result
   */
  send(method: string): Promise<unknown> {
    this.sent.push(method);
    if (method === 'DOM.describeNode') {
      return Promise.resolve({
        node: { nodeName: 'LABEL', localName: 'label', attributes: ['for', 'missing'] },
      });
    }
    return Promise.resolve({});
  }

  /**
   * Subscribe to an event.
   *
   * @param event - CDP event
   * @param handler - Handler
   * @returns Unsubscribe function
   */
  on(event: string, handler: (params: unknown, sessionId?: string) => void): () => void {
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
   * @param sessionId - Session of an attached target
   */
  emit(event: string, params: unknown, sessionId?: string): void {
    this.handlers.get(event)?.forEach((handler) => handler(params, sessionId));
  }
}

const QUIRKS: InspectorIssue = {
  code: 'QuirksModeIssue',
  details: {
    quirksModeIssueDetails: {
      isLimitedQuirksMode: false,
      documentNodeId: 2,
      url: 'http://localhost/quirks',
      frameId: 'main',
      loaderId: 'L1',
    },
  },
};

/**
 * A label whose `for` matches no id.
 *
 * @param node - The label's backend node id
 * @returns Issue
 */
function labelForMissing(node: number): InspectorIssue {
  return {
    code: 'GenericIssue',
    details: {
      genericIssueDetails: {
        errorType: 'FormLabelForMatchesNonExistingIdError',
        violatingNodeId: node,
        violatingNodeAttribute: 'for',
      },
    },
  };
}

const LABEL_FOR_MISSING = labelForMissing(7);

const FAILED_IMPORT: InspectorIssue = {
  code: 'StylesheetLoadingIssue',
  details: {
    stylesheetLoadingIssueDetails: {
      sourceCodeLocation: { url: 'http://localhost/import', lineNumber: 2, columnNumber: 24 },
      styleSheetLoadingIssueReason: 'RequestFailed',
      failedRequestInfo: {
        url: 'http://localhost/missing.css',
        failureMessage: 'net::ERR_ABORTED',
      },
    },
  },
};

const EVAL_BLOCKED: InspectorIssue = {
  code: 'ContentSecurityPolicyIssue',
  details: {
    contentSecurityPolicyIssueDetails: {
      violatedDirective: 'script-src',
      isReportOnly: false,
      contentSecurityPolicyViolationType: 'kEvalViolation',
      sourceCodeLocation: { url: 'http://localhost/csp', lineNumber: 0, columnNumber: 133 },
    },
  },
};

const SUMMARY_BUTTON: InspectorIssue = {
  code: 'ElementAccessibilityIssue',
  details: {
    elementAccessibilityIssueDetails: {
      nodeId: 40,
      elementAccessibilityIssueReason: 'InteractiveContentSummaryDescendant',
      hasDisallowedAttributes: false,
    },
  },
};

/**
 * A cookie issue.
 *
 * @param fields - Fields to override
 * @returns Issue
 */
function cookieIssue(fields: Partial<Protocol.Audits.CookieIssueDetails> = {}): InspectorIssue {
  return {
    code: 'CookieIssue',
    details: {
      cookieIssueDetails: {
        cookie: { name: 'a', path: '/', domain: 'localhost' },
        cookieWarningReasons: ['WarnSameSiteNoneInsecure'],
        cookieExclusionReasons: ['ExcludeSameSiteNoneInsecure'],
        operation: 'SetCookie',
        cookieUrl: 'http://localhost/cookie',
        ...fields,
      },
    },
  };
}

/**
 * A failed `@import` of its own stylesheet.
 *
 * @param n - Stylesheet number
 * @returns Issue
 */
function failedImport(n: number): InspectorIssue {
  return {
    code: 'StylesheetLoadingIssue',
    details: {
      stylesheetLoadingIssueDetails: {
        sourceCodeLocation: { url: 'http://localhost/import', lineNumber: 2, columnNumber: 24 },
        styleSheetLoadingIssueReason: 'RequestFailed',
        failedRequestInfo: { url: `http://localhost/${n}.css`, failureMessage: 'net::ERR_ABORTED' },
      },
    },
  };
}

void describe('toPageIssue', () => {
  void it('keeps quirks mode, form errors, stylesheet loading, eval CSP, a11y and document.cookie rejections', () => {
    const kept = [
      QUIRKS,
      LABEL_FOR_MISSING,
      FAILED_IMPORT,
      EVAL_BLOCKED,
      SUMMARY_BUTTON,
      cookieIssue(),
    ].map(toPageIssue);

    assert.deepEqual(
      kept.map((issue) => [issue?.code, issue?.type]),
      [
        ['QuirksModeIssue', undefined],
        ['GenericIssue', 'FormLabelForMatchesNonExistingIdError'],
        ['StylesheetLoadingIssue', 'RequestFailed'],
        ['ContentSecurityPolicyIssue', 'kEvalViolation'],
        ['ElementAccessibilityIssue', 'InteractiveContentSummaryDescendant'],
        ['CookieIssue', 'ExcludeSameSiteNoneInsecure'],
      ]
    );
    for (const issue of kept) assert.ok(issue?.text, 'each has a reason');
  });

  void it('points at the document, the element or the file and line', () => {
    assert.deepEqual(toPageIssue(QUIRKS)?.source, { url: 'http://localhost/quirks' });
    assert.deepEqual(toPageIssue(LABEL_FOR_MISSING)?.nodes, [{ backendNodeId: 7 }]);
    assert.deepEqual(toPageIssue(FAILED_IMPORT)?.source, {
      url: 'http://localhost/import',
      line: 3,
      column: 25,
    });
    assert.match(toPageIssue(FAILED_IMPORT)?.text ?? '', /missing\.css/);
    assert.deepEqual(toPageIssue(SUMMARY_BUTTON)?.nodes, [{ backendNodeId: 40 }]);
  });

  void it('drops noisy kinds: performance, lazy load, third-party phaseout, federated auth, deprecations', () => {
    const noisy: InspectorIssue[] = [
      {
        code: 'PerformanceIssue',
        details: { performanceIssueDetails: { performanceIssueType: 'DocumentCookie' } },
      },
      { code: 'LazyLoadImageIssue', details: {} },
      { code: 'FederatedAuthRequestIssue', details: {} },
      { code: 'DeprecationIssue', details: {} },
      cookieIssue({ cookieWarningReasons: ['WarnThirdPartyPhaseout'], cookieExclusionReasons: [] }),
    ];
    assert.deepEqual(
      noisy.map(toPageIssue),
      noisy.map(() => undefined)
    );
  });

  void it('drops cookie issues of requests (#493) and of cookies read', () => {
    const request = { requestId: '1', url: 'http://localhost/x.png' };
    assert.equal(toPageIssue(cookieIssue({ request })), undefined);
    assert.equal(toPageIssue(cookieIssue({ operation: 'ReadCookie' })), undefined);
  });

  void it('drops generic issues that are no form errors, and autocomplete advice', () => {
    for (const errorType of [
      'ResponseWasBlockedByORB',
      'FormInputAssignedAutocompleteValueToIdOrNameAttributeError',
      'FormAutocompleteAttributeEmptyError',
    ] as const) {
      const issue: InspectorIssue = {
        code: 'GenericIssue',
        details: { genericIssueDetails: { errorType, violatingNodeId: 3 } },
      };
      assert.equal(toPageIssue(issue), undefined, errorType);
    }
  });

  void it('drops CSP violations Chrome already logs to the console', () => {
    const urlViolation: InspectorIssue = {
      code: 'ContentSecurityPolicyIssue',
      details: {
        contentSecurityPolicyIssueDetails: {
          violatedDirective: 'img-src',
          isReportOnly: false,
          contentSecurityPolicyViolationType: 'kURLViolation',
          blockedURL: 'http://evil/x.png',
        },
      },
    };
    assert.equal(toPageIssue(urlViolation), undefined);
  });

  void it('caps the reason and the URLs', () => {
    const long = 'http://localhost/' + 'x'.repeat(5000) + '.css';
    const issue = toPageIssue({
      code: 'StylesheetLoadingIssue',
      details: {
        stylesheetLoadingIssueDetails: {
          sourceCodeLocation: { url: long, lineNumber: 0, columnNumber: 0 },
          styleSheetLoadingIssueReason: 'RequestFailed',
          failedRequestInfo: { url: long, failureMessage: 'net::ERR_ABORTED' },
        },
      },
    });
    assert.ok((issue?.text.length ?? Infinity) <= MAX_ISSUE_TEXT_LENGTH);
    assert.ok((issue?.source?.url.length ?? Infinity) <= MAX_ISSUE_TEXT_LENGTH);
  });
});

void describe('PageIssueLog', () => {
  void it('keeps an issue Chrome sends twice once', () => {
    const log = new PageIssueLog();
    assert.ok(log.add(LABEL_FOR_MISSING));
    assert.equal(log.add(structuredClone(LABEL_FOR_MISSING)), undefined);
    assert.equal(log.issues.length, 1);
  });

  void it('lists a form error on several elements once, with each element (twice sent, once counted)', () => {
    const log = new PageIssueLog();
    const duplicateId = (node: number): InspectorIssue => ({
      code: 'GenericIssue',
      details: {
        genericIssueDetails: {
          errorType: 'FormDuplicateIdForInputError',
          violatingNodeId: node,
          violatingNodeAttribute: 'id',
        },
      },
    });
    for (const node of [15, 16, 15, 16]) log.add(duplicateId(node));
    assert.equal(log.issues.length, 1);
    assert.equal(log.issues[0]?.count, 2);
    assert.deepEqual(
      log.issues[0]?.nodes?.map((node) => node.backendNodeId),
      [15, 16]
    );
  });

  void it(`keeps the first ${MAX_ISSUE_NODES} elements of an issue and counts them all`, () => {
    const log = new PageIssueLog();
    for (let node = 0; node < MAX_ISSUE_NODES + 3; node++) {
      log.add(labelForMissing(node));
    }
    assert.equal(log.issues[0]?.nodes?.length, MAX_ISSUE_NODES);
    assert.equal(log.issues[0]?.count, MAX_ISSUE_NODES + 3);
  });

  void it(`keeps the first ${MAX_PAGE_ISSUES} issues of a page and counts the rest`, () => {
    const log = new PageIssueLog();
    for (let n = 0; n < MAX_PAGE_ISSUES + 5; n++) log.add(failedImport(n));
    log.add(failedImport(0));
    log.add(failedImport(MAX_PAGE_ISSUES + 1));
    assert.equal(log.issues.length, MAX_PAGE_ISSUES);
    assert.equal(log.dropped, 5);
  });

  void it(`never counts a repeat twice, also past ${MAX_ISSUE_SEEN_REPORTS} distinct reports`, () => {
    const log = new PageIssueLog();
    const past = MAX_ISSUE_SEEN_REPORTS + 50;
    for (let n = 0; n < past; n++) log.add(failedImport(n));
    const dropped = log.dropped;
    assert.equal(
      dropped,
      MAX_ISSUE_SEEN_REPORTS - MAX_PAGE_ISSUES,
      'reports past the limit are not counted'
    );
    log.add(failedImport(5));
    log.add(failedImport(past - 1));
    assert.equal(log.dropped, dropped, 'repeats do not inflate the dropped count');
  });

  void it('counts the elements of a form error once each however many reports came before', () => {
    const log = new PageIssueLog();
    log.add(labelForMissing(1));
    for (let n = 0; n < MAX_ISSUE_SEEN_REPORTS + 10; n++) log.add(failedImport(n));
    log.add(labelForMissing(1));
    log.add(labelForMissing(2));
    log.add(labelForMissing(2));
    assert.equal(log.issues[0]?.count, 2);
  });

  void it('starts over for a new page', () => {
    const log = new PageIssueLog();
    log.add(QUIRKS);
    for (let n = 0; n < MAX_PAGE_ISSUES + 1; n++) log.add(failedImport(n));
    log.clear();
    assert.deepEqual([log.issues.length, log.dropped], [0, 0]);
    assert.ok(log.add(QUIRKS), 'the same issue on the new page counts again');
  });
});

void describe('startIssueCollection', () => {
  void it('enables Audits and keeps allowlisted issues of the page', async () => {
    const cdp = new MockCDP();
    const log = new PageIssueLog();
    await startIssueCollection(cdp as unknown as CDPConnection, log);
    assert.ok(cdp.sent.includes('Audits.enable'));

    cdp.emit('Audits.issueAdded', {
      issue: {
        code: 'PerformanceIssue',
        details: { performanceIssueDetails: { performanceIssueType: 'DocumentCookie' } },
      },
    });
    cdp.emit('Audits.issueAdded', { issue: QUIRKS });
    cdp.emit('Audits.issueAdded', { issue: QUIRKS });
    assert.deepEqual(
      log.issues.map((issue) => issue.code),
      ['QuirksModeIssue']
    );
  });

  void it('names the element at fault once Chrome describes it', async () => {
    const cdp = new MockCDP();
    const log = new PageIssueLog();
    await startIssueCollection(cdp as unknown as CDPConnection, log);

    cdp.emit('Audits.issueAdded', { issue: LABEL_FOR_MISSING });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(log.issues[0]?.nodes?.[0]?.description, 'label[for="missing"]');
  });

  void it("clears the previous page's issues on a main-frame navigation only", async () => {
    const cdp = new MockCDP();
    const log = new PageIssueLog();
    await startIssueCollection(cdp as unknown as CDPConnection, log);

    cdp.emit('Audits.issueAdded', { issue: QUIRKS });
    cdp.emit('Page.frameNavigated', { frame: { id: 'child', parentId: 'main', url: 'x' } });
    assert.equal(log.issues.length, 1, 'an iframe navigation keeps them');
    cdp.emit('Page.frameNavigated', { frame: { id: 'main', url: 'http://localhost/next' } });
    assert.equal(log.issues.length, 0);
  });

  void it('ignores issues of attached child targets', async () => {
    const cdp = new MockCDP();
    const log = new PageIssueLog();
    await startIssueCollection(cdp as unknown as CDPConnection, log);

    cdp.emit('Audits.issueAdded', { issue: QUIRKS }, 'child-session');
    assert.equal(log.issues.length, 0);
  });

  void it('stops collecting after cleanup', async () => {
    const cdp = new MockCDP();
    const log = new PageIssueLog();
    const stop = await startIssueCollection(cdp as unknown as CDPConnection, log);
    await stop();
    cdp.emit('Audits.issueAdded', { issue: QUIRKS });
    assert.equal(log.issues.length, 0);
  });
});
