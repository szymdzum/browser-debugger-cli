/**
 * Normalize a URL by adding http:// protocol if missing
 * Supports: localhost:3000, example.com, http://localhost, file:// URLs
 */
export function normalizeUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
    return url;
  }
  return `http://${url}`;
}
