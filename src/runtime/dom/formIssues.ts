/**
 * Chrome's form markup errors (Issues panel) in `bdg dom form`: next to each
 * listed field at fault (matched by backend node id), and in a list of their
 * own for the other elements at fault. A label whose `for` matches no id is
 * an error of the label, which labels no field, so it is listed on its own.
 */

import type { FormIssue, RawField, RawFormData } from '@/ipc/protocol/domTypes.js';
import type { IssueNode, PageIssue } from '@/types.js';

/** Chrome's code of the form errors (the only generic issues bdg keeps) */
const FORM_ISSUE_CODE = 'GenericIssue';

/**
 * Add the page's form errors to discovered forms.
 *
 * @param data - Discovered forms, fields with their backend node ids
 * @param issues - Chrome Issues of the page
 * @returns The forms with `issues` on fields and `formIssues` for the rest
 */
export function withFormIssues(data: RawFormData, issues: readonly PageIssue[]): RawFormData {
  const formIssues = issues.filter((issue) => issue.code === FORM_ISSUE_CODE);
  if (formIssues.length === 0) return data;
  const fieldNodes = new Set(
    data.forms.flatMap((form) => form.fields.map((field) => field.backendNodeId))
  );
  const withIssues = (field: RawField): RawField => {
    const own = formIssues.filter((issue) =>
      issue.nodes?.some((node) => node.backendNodeId === field.backendNodeId)
    );
    return own.length > 0 ? { ...field, issues: own.map((issue) => issue.text) } : field;
  };
  const forms = data.forms.map((form) => ({ ...form, fields: form.fields.map(withIssues) }));
  const rest = formIssues.flatMap((issue) => unlistedPart(issue, fieldNodes));
  return { ...data, forms, ...(rest.length > 0 && { formIssues: rest }) };
}

/**
 * The part of an issue about elements that are no listed field.
 *
 * @param issue - Form error
 * @param fieldNodes - Backend node ids of the listed fields
 * @returns The issue with those elements, none when every element is listed
 */
function unlistedPart(issue: PageIssue, fieldNodes: Set<number | undefined>): FormIssue[] {
  if (!issue.nodes?.length) return [{ text: issue.text }];
  const unlisted = issue.nodes.filter((node) => !fieldNodes.has(node.backendNodeId));
  if (unlisted.length === 0) return [];
  const elements = unlisted.map(nodeName);
  return [{ text: issue.text, elements }];
}

/**
 * Name of an element at fault.
 *
 * @param node - Element
 * @returns Its description, or its node id while it is not described
 */
function nodeName(node: IssueNode): string {
  return node.description ?? `node ${node.backendNodeId}`;
}
