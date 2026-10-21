<!-- AREA -->
**Network and timing.** `bdg network list` (with `--sort`, `--filter`, `--preset`, `--last`, `--page`), `network details`, `network headers`, HAR export (`network har`) and the timing breakdown must match what the browser really sent and received. Make bdg show a wrong status, size, duration, type, initiator or header, miss a request, show one twice, mix requests of two pages, attribute time to the wrong phase, or write a HAR that disagrees with the page's own measurements.
<!-- TARGETS -->
- **Truth sources** to compare against: the page's own `performance.getEntriesByType('resource')` and `PerformanceResourceTiming` (with `Timing-Allow-Origin`), your server's log of what it received and sent (bytes, status, timestamps), and raw CDP events.
- **Bodies and sizes**: gzip/br/chunked responses, a `Content-Length` that lies, a 0-byte 200, a body over several MB, a streamed response that stalls in the middle, binary vs text, `data:` and `blob:` URLs.
- **Status and redirects**: a redirect chain (do the hops show, with which status), a 304 from a conditional request, a request served from memory or disk cache, a service-worker response, a CORS preflight and a CORS failure.
- **Timing**: a server that waits before headers vs one that sends headers and trickles the body; many parallel requests to one HTTP/1.1 host (queueing); a request still pending when you list; a long-poll; a WebSocket and an EventSource.
- **Identity**: two requests to the same URL, a request re-sent after a navigation, requests from an iframe and a worker, `fetch` with `keepalive` during unload, a beacon.
- **Headers**: duplicate headers, `Set-Cookie` lines, very long headers, headers with non-ASCII values; request headers the page set vs what arrived at your server.
- **HAR**: open the file and compare entries, sizes and timings with your server log.
<!-- COVERED -->
a still-pending request in `--sort duration` and `--preset slow`; blocked cookies with their reasons; wait/download/queued on six connections to one host; secrets in request bodies and headers being redacted; network list after a navigation (`--page`).
