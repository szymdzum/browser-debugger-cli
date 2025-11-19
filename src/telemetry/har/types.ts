/**
 * HAR (HTTP Archive) 1.2 format type definitions.
 *
 * @see http://www.softwareishard.com/blog/har-12-spec/
 */

/**
 * Root HAR object containing log data.
 */
export interface HAR {
  log: Log;
}

/**
 * Log object containing HAR metadata and entries.
 */
export interface Log {
  /** HAR format version (always "1.2") */
  version: string;
  /** Information about the application that created the log */
  creator: Creator;
  /** Information about the browser that was used */
  browser?: Browser;
  /** List of page objects (optional) */
  pages?: Page[];
  /** List of network request/response entries */
  entries: Entry[];
  /** Comment provided by the user or application (optional) */
  comment?: string;
}

/**
 * Creator object describing the application that created the HAR file.
 */
export interface Creator {
  /** Name of the application */
  name: string;
  /** Version of the application */
  version: string;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Browser object describing the browser used.
 */
export interface Browser {
  /** Name of the browser */
  name: string;
  /** Version of the browser */
  version: string;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Page object representing a loaded page.
 */
export interface Page {
  /** Date and time stamp for the beginning of the page load (ISO 8601) */
  startedDateTime: string;
  /** Unique identifier of a page within the log */
  id: string;
  /** Page title */
  title: string;
  /** Detailed timing info about page load */
  pageTimings: PageTimings;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Page timing information.
 */
export interface PageTimings {
  /** Content of the page loaded (onContentLoad event timing in milliseconds, -1 if unknown) */
  onContentLoad?: number;
  /** Page is loaded (onLoad event timing in milliseconds, -1 if unknown) */
  onLoad?: number;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Entry object representing a single network request/response pair.
 */
export interface Entry {
  /** Reference to the parent page (optional) */
  pageref?: string;
  /** Date and time stamp of the request start (ISO 8601) */
  startedDateTime: string;
  /** Total elapsed time of the request in milliseconds */
  time: number;
  /** Detailed info about the request */
  request: Request;
  /** Detailed info about the response */
  response: Response;
  /** Info about cache usage */
  cache: Cache;
  /** Detailed timing info about request/response round trip */
  timings: Timings;
  /** IP address of the server */
  serverIPAddress?: string;
  /** Unique ID of the TCP/IP connection (reuse connection if same ID) */
  connection?: string;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Request object containing detailed info about the request.
 */
export interface Request {
  /** Request method (GET, POST, etc.) */
  method: string;
  /** Absolute URL of the request (fragments not included) */
  url: string;
  /** Request HTTP version */
  httpVersion: string;
  /** List of cookie objects */
  cookies: Cookie[];
  /** List of header objects */
  headers: Header[];
  /** List of query parameter objects */
  queryString: QueryParam[];
  /** Posted data info (optional) */
  postData?: PostData;
  /** Total number of bytes from the start of the HTTP request message until (and including) the double CRLF before the body */
  headersSize: number;
  /** Size of the request body in bytes (-1 if not available) */
  bodySize: number;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Response object containing detailed info about the response.
 */
export interface Response {
  /** Response status code */
  status: number;
  /** Response status description */
  statusText: string;
  /** Response HTTP version */
  httpVersion: string;
  /** List of cookie objects */
  cookies: Cookie[];
  /** List of header objects */
  headers: Header[];
  /** Response body details */
  content: Content;
  /** Redirection target URL from the Location response header */
  redirectURL: string;
  /** Total number of bytes from the start of the HTTP response message until (and including) the double CRLF before the body */
  headersSize: number;
  /** Size of the received response body in bytes (-1 if not available) */
  bodySize: number;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Cookie object.
 */
export interface Cookie {
  /** Cookie name */
  name: string;
  /** Cookie value */
  value: string;
  /** Cookie path (optional) */
  path?: string;
  /** Cookie domain (optional) */
  domain?: string;
  /** Cookie expiration time (ISO 8601, optional) */
  expires?: string;
  /** True if cookie is HTTP only (optional) */
  httpOnly?: boolean;
  /** True if cookie is secure (optional) */
  secure?: boolean;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Header object.
 */
export interface Header {
  /** Header name */
  name: string;
  /** Header value */
  value: string;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Query parameter object.
 */
export interface QueryParam {
  /** Parameter name */
  name: string;
  /** Parameter value */
  value: string;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Posted data object.
 */
export interface PostData {
  /** MIME type of posted data */
  mimeType: string;
  /** List of posted parameters (parsed from request body) */
  params: PostParam[];
  /** Plain text posted data */
  text: string;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Posted parameter object.
 */
export interface PostParam {
  /** Parameter name */
  name: string;
  /** Parameter value (optional) */
  value?: string;
  /** Name of uploaded file (optional) */
  fileName?: string;
  /** Content type of uploaded file (optional) */
  contentType?: string;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Content object describing response body.
 */
export interface Content {
  /** Length of returned content in bytes */
  size: number;
  /** Number of bytes saved by compression (-1 if not available) */
  compression?: number;
  /** MIME type of the response text */
  mimeType: string;
  /** Response body text (optional) */
  text?: string;
  /** Encoding used for response text (e.g., "base64") (optional) */
  encoding?: string;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Cache object containing info about cache usage.
 */
export interface Cache {
  /** State of a cache entry before the request (optional) */
  beforeRequest?: CacheEntry;
  /** State of a cache entry after the request (optional) */
  afterRequest?: CacheEntry;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Cache entry object.
 */
export interface CacheEntry {
  /** Expiration time of the cache entry (ISO 8601, optional) */
  expires?: string;
  /** Last time the cache entry was opened (ISO 8601) */
  lastAccess: string;
  /** ETag */
  eTag: string;
  /** Number of times the cache entry has been opened */
  hitCount: number;
  /** Comment (optional) */
  comment?: string;
}

/**
 * Timings object describing various phases of the request/response timing.
 * All times are in milliseconds. Use -1 if timing does not apply or is unknown.
 */
export interface Timings {
  /** Time spent in a queue waiting for a network connection (-1 if not applicable) */
  blocked?: number;
  /** DNS resolution time (-1 if not applicable) */
  dns?: number;
  /** Time required to create TCP connection (-1 if not applicable) */
  connect?: number;
  /** Time required to send HTTP request to the server */
  send: number;
  /** Waiting for a response from the server */
  wait: number;
  /** Time required to read entire response from the server */
  receive: number;
  /** Time required for SSL/TLS negotiation (-1 if not applicable) */
  ssl?: number;
  /** Comment (optional) */
  comment?: string;
}
