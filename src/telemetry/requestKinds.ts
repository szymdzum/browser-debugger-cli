/**
 * Which requests an action is about (pages, API calls, sockets) and which
 * are static assets loaded along the way (stylesheets, scripts, fonts,
 * images), by CDP resource type.
 */

/**
 * Resource types listed one by one after an action: pages, API calls,
 * sockets, and the requests a page sends about itself (pings, beacons,
 * preflights, CSP reports)
 */
const ACTIVITY_RESOURCE_TYPES = new Set([
  'Document',
  'XHR',
  'Fetch',
  'WebSocket',
  'EventSource',
  'Ping',
  'Preflight',
  'CSPViolationReport',
]);

/** Short names of asset types, in the order summaries list them */
const ASSET_TYPE_NAMES: ReadonlyArray<[string, string]> = [
  ['Stylesheet', 'css'],
  ['Script', 'js'],
  ['Font', 'fonts'],
  ['Image', 'images'],
  ['Media', 'media'],
];

/** Fields a request needs to be classified */
interface ClassifiedRequest {
  method?: string | undefined;
  resourceType?: string | undefined;
  status?: number | undefined;
  failed?: true | undefined;
}

/**
 * Whether a request is worth its own line after an action: one of the
 * {@link ACTIVITY_RESOURCE_TYPES}, one of unknown type, any request that is
 * not a GET (a `sendBeacon` POST typed `Other`), or an asset that failed (an
 * HTTP error or no response).
 *
 * @param request - Request with its method and CDP resource type
 * @returns False for assets fetched with GET that loaded normally
 */
export function isNotableRequest(request: ClassifiedRequest): boolean {
  if (request.resourceType === undefined || ACTIVITY_RESOURCE_TYPES.has(request.resourceType)) {
    return true;
  }
  if (request.method !== undefined && request.method.toUpperCase() !== 'GET') return true;
  return request.failed === true || (request.status ?? 0) >= 400;
}

/**
 * Short names of the asset types among requests, e.g. `["css", "js", "images"]`
 * (types without a short name are lowercased, after the known ones).
 *
 * @param requests - Asset requests
 * @returns Distinct names, known types first
 */
export function assetTypeNames(requests: ClassifiedRequest[]): string[] {
  const types = new Set(requests.map((request) => request.resourceType ?? 'Other'));
  const known = ASSET_TYPE_NAMES.filter(([type]) => types.has(type)).map(([, name]) => name);
  const others = [...types]
    .filter((type) => !ASSET_TYPE_NAMES.some(([known]) => known === type))
    .map((type) => type.toLowerCase());
  return [...known, ...others];
}
