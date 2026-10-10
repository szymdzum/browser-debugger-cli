/**
 * Chrome's form markup errors (Issues panel) in `bdg dom form`: next to each
 * listed field at fault (matched by backend node id), and in a list of their
 * own for the other elements at fault. A label whose `for` matches no id is
 * an error of the label, which labels no field, so it is listed on its own.
 *
 * Issues are reported while the page loads; a single-page app may have
 * re-rendered the form since. Elements no longer in the document are left
 * out, and so is an error with none left.
 */

import type { FormIssue, RawField, RawFormData } from '@/ipc/protocol/domTypes.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import type { IssueNode, PageIssue } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Chrome's code of the form errors (the only generic issues bdg keeps) */
const FORM_ISSUE_CODE = 'GenericIssue';

/** Counter giving each lookup its own object group (commands run concurrently) */
let nodeLookups = 0;

/**
 * The form errors among the page's issues.
 *
 * @param issues - Chrome Issues of the page
 * @returns Form errors
 */
export function formErrors(issues: readonly PageIssue[]): PageIssue[] {
  return issues.filter((issue) => issue.code === FORM_ISSUE_CODE);
}

/**
 * Whether one element is still in the document.
 *
 * @param cdp - Connection to the page
 * @param backendNodeId - Element
 * @param objectGroup - Object group of the lookup
 * @returns False when it is gone or detached
 */
async function isConnected(
  cdp: CDPSender,
  backendNodeId: number,
  objectGroup: string
): Promise<boolean> {
  try {
    const { object } = (await cdp.send('DOM.resolveNode', {
      backendNodeId,
      objectGroup,
    })) as { object: { objectId?: string } };
    if (!object.objectId) return false;
    const { result } = (await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { return this.isConnected; }',
      returnByValue: true,
    })) as { result: { value?: unknown } };
    return result.value === true;
  } catch (error) {
    log.debug(`Issue element ${backendNodeId} gone: ${getErrorMessage(error)}`);
    return false;
  }
}

/**
 * The elements still in the document (looked up together, then released).
 * The lookup has an object group of its own, so a concurrent command's
 * release does not free its elements before they are read.
 *
 * @param cdp - Connection to the page
 * @param backendNodeIds - Elements
 * @returns Those still connected
 */
export async function connectedNodes(
  cdp: CDPSender,
  backendNodeIds: readonly number[]
): Promise<Set<number>> {
  if (backendNodeIds.length === 0) return new Set();
  const objectGroup = `bdg-issue-nodes-${++nodeLookups}`;
  const results = await Promise.all(backendNodeIds.map((id) => isConnected(cdp, id, objectGroup)));
  await cdp
    .send('Runtime.releaseObjectGroup', { objectGroup })
    .catch((error: unknown) => log.debug(`Issue nodes not released: ${getErrorMessage(error)}`));
  return new Set(backendNodeIds.filter((_id, i) => results[i]));
}

/**
 * Add the page's form errors to discovered forms.
 *
 * @param data - Discovered forms, fields with their backend node ids
 * @param issues - Chrome Issues of the page
 * @param connected - Elements of the errors still in the document
 * @returns The forms with `issues` on fields and `formIssues` for the rest
 */
export function withFormIssues(
  data: RawFormData,
  issues: readonly PageIssue[],
  connected: ReadonlySet<number>
): RawFormData {
  const errors = formErrors(issues);
  if (errors.length === 0) return data;
  const fieldNodes = new Set(
    data.forms.flatMap((form) => form.fields.map((field) => field.backendNodeId))
  );
  const withIssues = (field: RawField): RawField => {
    const own = errors.filter((issue) =>
      issue.nodes?.some((node) => node.backendNodeId === field.backendNodeId)
    );
    return own.length > 0 ? { ...field, issues: own.map((issue) => issue.text) } : field;
  };
  const forms = data.forms.map((form) => ({ ...form, fields: form.fields.map(withIssues) }));
  const rest = errors.flatMap((issue) => unlistedPart(issue, fieldNodes, connected));
  return { ...data, forms, ...(rest.length > 0 && { formIssues: rest }) };
}

/**
 * The part of an issue about elements that are no listed field and are
 * still in the document (and were described).
 *
 * @param issue - Form error
 * @param fieldNodes - Backend node ids of the listed fields
 * @param connected - Elements still in the document
 * @returns The issue with those elements, none when no such element is left
 */
function unlistedPart(
  issue: PageIssue,
  fieldNodes: Set<number | undefined>,
  connected: ReadonlySet<number>
): FormIssue[] {
  if (!issue.nodes?.length) return [{ text: issue.text }];
  const elements = issue.nodes
    .filter((node) => !fieldNodes.has(node.backendNodeId) && connected.has(node.backendNodeId))
    .flatMap((node: IssueNode) => node.description ?? []);
  return elements.length > 0 ? [{ text: issue.text, elements }] : [];
}
